import express from 'express';
import cors from'cors';
import { SessionTx, WithdrawTx } from './db_connection';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import ethereumjsUtil from 'ethereumjs-util';
import abi from 'ethereumjs-abi';
import { getEthGateway, connectHDWallet } from './eth';
import { keystore, encryption } from 'eth-lightwallet';
import BN from 'bn.js';
import BigNumber from 'bignumber.js';
import CryptoJS from 'crypto-js';
import { getPublicKey, notifyParticipant } from './api.js';
import deepstream from 'deepstream.io-client-js';
import moment, { now } from 'moment';

dotenv.config();
connectHDWallet();
BigNumber.config({ ERRORS: false });
let ksPP = null;
let pwDerivedKeyPP = null;
let isConnectedToDS = false;


keystore.createVault(
  {
    password:  process.env.PWD,
    seedPhrase: process.env.MNEMONIC,
    hdPathString: "m/44'/60'/0'/0",
  },
  (err, ks) => {
    if (err) throw err;

    ks.keyFromPassword(process.env.PWD, (errPwDerivedKey, pwDerivedKey) => {
      ksPP = ks;
      pwDerivedKeyPP = pwDerivedKey;
      const hdPath = "m/0'/0'/2'";
      ks.addHdDerivationPath(hdPath, pwDerivedKey, {
        curve: 'curve25519',
        purpose: 'asymEncrypt',
      });
      ks.generateNewEncryptionKeys(pwDerivedKey, 1, hdPath);

      const pubKeys = ks.getPubKeys(hdPath);
      console.log(pubKeys);
    });
  }
);

const ds = deepstream( process.env.DS_URL, { maxReconnectAttempts: Infinity } );
  ds.login({ username: 'payment-pool', access_token: '1234' }, function( success, errorEvent, errorMsg ) {
});

ds.on( 'error', ( error ) => {
  console.log('DS error '+error);
} );

ds.on('connectionStateChanged', connectionState => {
  isConnectedToDS = connectionState === 'OPEN';

  if (isConnectedToDS) console.log('connected to DS');
  else console.log ('connection to DS not OPEN, crt status:', connectionState)
})


const asyncMiddleware = fn =>
(req, res, next) => {
  Promise.resolve(fn(req, res, next))
    .catch(next);
};

let app = express();
app.use(cors());

app.use((req, res, next) => {
  if (isConnectedToDS) {
      return next();
  }

  res.status(503);
  res.send('503: DS connection not OPEN');
});

app.use( bodyParser.json() );  
app.use(bodyParser.urlencoded({// to support URL-encoded bodies
  extended: true
})); 

app.use((err, req, res, next) => {
  if (! err) {
      return next();
  }

  res.status(500);
  res.send('500: Internal server error');
});

process.on('uncaughtException', function(error) {
  console.log('uncaughtException', error);
});

process.on('unhandledRejection', function(reason, p){
  console.log('unhandledRejection', reason);
});

const randomString = (length, chars) => {
  let mask = '';
  if (chars.indexOf('a') > -1) mask += 'abcdefghijklmnopqrstuvwxyz';
  if (chars.indexOf('A') > -1) mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (chars.indexOf('#') > -1) mask += '0123456789';
  if (chars.indexOf('!') > -1) mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
  let result = '';
  for (let i = length; i > 0; i -= 1) result += mask[Math.floor(Math.random() * mask.length)];
  return result;
};

const getPaidAmount = async (sessionId, address) => {
  const sessionTx = await SessionTx.find({where: {session_id: sessionId, from_address: address} });
  if (sessionTx){
    const txInfo = sessionTx.get({ plain: true });
    return txInfo.value.toString();
  } else {
    const amountToReceive = await SessionTx.sum('value', { where: {session_id: sessionId, to_address: address} });
    if (amountToReceive > 0) return amountToReceive.toString();
  }

  return '0';
}

const sendEndSessionMessage = (address, conferenceSession) => {
  getPublicKey(address).then(result => {
    if (result.data.success === 1){
      const pkey = result.data.result;
        const AESKey = randomString(32, 'aA#');
        
        const hdPath = "m/0'/0'/2'";
        const pubKeys = ksPP.getPubKeys(hdPath);
        const encryptedAESKey = encryption.asymEncryptString(
          ksPP,
          pwDerivedKeyPP,
          AESKey,
          pubKeys[0],
          pkey,
          hdPath
        );

        const messageTime = new Date().getTime();
        
        const conferenceMessage = {
          ref: conferenceSession.ref,
          owner: conferenceSession.owner,
          ownerId: conferenceSession.ownerId,
          fee: conferenceSession.fee,
          ethFee: conferenceSession.ethFee,
          UsdEthRate: conferenceSession.UsdEthRate,
          participantsCount: Object.keys(conferenceSession.participants).length,
          amount: getPaidAmount(conferenceSession.ref, address),
          type: 'endConference',
          isSystem: true,
        };

        const message = {
          content: conferenceMessage,
          user: 'system',
          type: 'endConference',
          timestamp: messageTime,
        };

        const encryptedMessage = CryptoJS.AES.encrypt(
          JSON.stringify(message),
          AESKey
        ).toString();

        const messageUID = `endConference/${conferenceSession.ref}/${conferenceSession.participants[address].id}`;
        ds.record.getRecord(`message/${messageUID}`).whenReady(record => {
          record.set('msg', encryptedMessage);
          record.set('key', encryptedAESKey);
          record.set('pkey', pubKeys[0]);
          ds.record
            .getList(`messageHistory/${conferenceSession.roomId}`)
            .whenReady(list => {
              list.addEntry(`message/${messageUID}`);
            });
        });

        const msgEventPayload = {
          msg: encryptedMessage,
          key: encryptedAESKey,
          pkey: pubKeys[0],
          id: `message/${messageUID}`,
        };
        ds.event.emit(`messages/${conferenceSession.roomId}`, msgEventPayload);
        notifyParticipant(
          conferenceSession.owner, 
          conferenceMessage.amount, 
          'session_confirmation_kp',
          conferenceSession.ref,           
          conferenceMessage.participantsCount
        );
    }
  });
}

const closeZombieSessions = () => {
  if (isConnectedToDS){
    const limit = moment().subtract(1, 'minutes');
    SessionTx.findAll({where: {updated_at: {$lt: limit.format('YYYY-MM-DD HH:mm:ss')}, commited: 0, pending: 0}}).then(sessionTxs => {
      if(sessionTxs) {
        for (let i=0; i<sessionTxs.length; i++) {
          const ok = commitTransaction(sessionTxs[i]);
          if (!ok) {
            continue;
          }

          ds.record
          .getRecord(`conferenceSession/${sessionTxs[i].session_id}`)
          .whenReady(conferenceSessionRef => {
            const conferenceSession = conferenceSessionRef.get();
            sendEndSessionMessage(sessionTxs[i].from_address, conferenceSession);
            
            let leftCount = 0;
            const participants = conferenceSession.participants;
            Object.keys(participants).forEach(participantAddress => {
              if (participants[participantAddress].leftSession) leftCount += 1;
            });
        
            if (Object.keys(participants).length === leftCount + 2) {
              sendEndSessionMessage(sessionTxs[i].to_address, conferenceSession);
            }
          });

          ds.rpc.make(
            'setUserLeftInConference',
            { sessionId: sessionTxs[i].session_id, 
              address: sessionTxs[i].from_address, 
              val: true },
            ( error, userId ) => {
              if (!error){
                console.log('userID',userId);
              }
            });
        }
      }
    });
  }
};

const zombieKillerInterval = setInterval(closeZombieSessions, 10000);

app.post('/testGetBalance', function (req, res) {
  res.send('it is working');
});

app.post('/storeTxMessage', function (req, res) {   
  
  try{
    const intSessionId = req.body.session_id.replace(/-/g, '');
    let transactionHash = abi.soliditySHA3(
      ["int", "address", "address",  "int" ],
      [ intSessionId, 
        req.body.fromAddress, 
        req.body.toAddress, 
        req.body.value]
    ).toString('hex');
    transactionHash = ethereumjsUtil.addHexPrefix(transactionHash);
    transactionHash = ethereumjsUtil.toBuffer(transactionHash);

    const signature = ethereumjsUtil.fromRpcSig(req.body.signature);
    const signerPublicKey = ethereumjsUtil.ecrecover(transactionHash, signature.v, signature.r, signature.s);
    const signerAddressBuf = ethereumjsUtil.pubToAddress(signerPublicKey);
    const signerAddress = ethereumjsUtil.bufferToHex(signerAddressBuf);
    
    const isValid = signerAddress === req.body.fromAddress;    
    
    if (isValid){
      getEthGateway().getDeposit(req.body.fromAddress).then( balance => {
        console.log('balance for balance', req.body.fromAddress, balance.toString(), req.body.value);
        SessionTx.findOrCreate({
          where: {session_id: req.body.session_id, from_address: req.body.fromAddress},
          defaults: {to_address: req.body.toAddress, commited: 0, pending: 0, receipt: ''}
        }).then(sessionTx => {
          const crtSessionTx = sessionTx[0];
          if (!crtSessionTx.value){ crtSessionTx.value = 0; }
          const crtValue = new BigNumber (crtSessionTx.value);
          const newValue = new BigNumber (req.body.value);

          if (crtValue.lt(newValue) && newValue.lt(balance)) {
            console.log('valid conditions', req.body.session_id);
            crtSessionTx.value = req.body.value;
            crtSessionTx.signature = req.body.signature;
            crtSessionTx.save();
            res.send('valid');  
          } else {
            console.log('invalid conditions', req.body.value, balance.toString(), crtSessionTx.value)
            res.send('invalid');
          }     
        });
      }).catch(e => {
        res.send('invalid');
      })
    } else {
      res.send('invalid');
    }
  }
  catch (e) {
    console.log(e);
    res.send('invalid');
  }
});

app.post('/withdrawTxMessage', function (req, res) { 
  try{
    const toAddress = req.body.toAddress;
    const withdrawTimeLimit = req.body.withdrawTimeLimit;
    const signature = req.body.signature;
    
    let transactionHash = abi.soliditySHA3(
      ["address"],
      [ toAddress]
    ).toString('hex');
    
    transactionHash = ethereumjsUtil.addHexPrefix(transactionHash);
    transactionHash = ethereumjsUtil.toBuffer(transactionHash);

    const signatureTx = ethereumjsUtil.fromRpcSig(req.body.signature);
    const signerPublicKey = ethereumjsUtil.ecrecover(transactionHash, signatureTx.v, signatureTx.r, signatureTx.s);
    const signerAddressBuf = ethereumjsUtil.pubToAddress(signerPublicKey);
    const signerAddress = ethereumjsUtil.bufferToHex(signerAddressBuf);
    
    const isValid = signerAddress === req.body.toAddress;
     
    if (isValid) {
      
      WithdrawTx.findOrCreate({
        where: {to_address: toAddress},
        defaults: {
          to_address: toAddress, 
          signature: signature, 
          commited: 0, 
          pending: 0, 
          by_user: 0,
          cooldown_expire: new Date(withdrawTimeLimit*1000),
          receipt: null,
          tx_hash: null
        }
      }).then(withdrawTx => {
        const updateWithdrawTx = withdrawTx[0];
        updateWithdrawTx.to_address = toAddress;
        updateWithdrawTx.signature = signature;
        updateWithdrawTx.commited = 0;
        updateWithdrawTx.pending = 0;
        updateWithdrawTx.by_user = 0;
        updateWithdrawTx.cooldown_expire = new Date(withdrawTimeLimit*1000);
        updateWithdrawTx.receipt = null,
        updateWithdrawTx.tx_hash = null,
        updateWithdrawTx.save();
      });
     
    }    
    
    res.send(isValid ? 'valid' : 'forgery');
    
  }
  catch (e) {
    console.log(e);
    res.send(req.body);
  }
});

app.post('/getSumOfPendingMessages', asyncMiddleware(async (req, res, next) => {
  const sessionTxs = await SessionTx.findAll({where: {session_id: req.body.session_id}});
  let valueByAddress={};
  if(sessionTxs) {
    for (let i=0; i<sessionTxs.length; i++) {
      const txInfo = sessionTxs[i].get({ plain: true });
      valueByAddress[txInfo.from_address] = {};
      valueByAddress[txInfo.from_address].totalValue = await SessionTx.sum('value', { where: { from_address: { $eq: txInfo.from_address }, commited: 0 } });
      valueByAddress[txInfo.from_address].thisSessionValue = txInfo.value;
    }
  }

  const amountToReceive = await SessionTx.sum('value', { where: {session_id: req.body.session_id} });
  res.send({amountToReceive, valueByAddress})
}));

app.post('/endSessionByUser', function (req, res){
  console.log('end ses by user', req.body);
  SessionTx.findOne({where: {session_id: req.body.session_id, from_address: req.body.address}}).then(sessionTx => {
    if (sessionTx) {      
      commitTransaction(sessionTx);      
    };
  });

  res.send('commited');
});

app.post('/getSessionTxInfo', function (req, res){
  
  SessionTx.findOne({where: {to_address: req.body.toAddress, from_address: req.body.fromAddress, session_id: req.body.session_id}}).then(sTx => {
    if (sTx) {      
      res.send(sTx);
    } else { 
      res.send("0");
    }
  });    
});

app.post('/getWithdrawTxInfo', function (req, res){
  
  WithdrawTx.findOne({where: {to_address: req.body.to_address}}).then(wTx => {
    if (wTx) {      
      res.send(wTx);
    } else { 
      res.send("0");
    }
  });    
});

app.post('/withdrawByUser', function (req, res){    
  WithdrawTx.findOne({where: {to_address: req.body.to_address}}).then(wTx => {
    if (wTx) {
      wTx.by_user = 1;
      wTx.save();    
      res.send("withdraw tx by user set.");
    } else { 
      res.send("withdraw tx not found.");
    }
  });    
});

app.post('/getPaidAmount', asyncMiddleware(async (req, res, next) => {
  const returnValue = await getPaidAmount(req.body.session_id, req.body.address);
  res.send(returnValue);
}));

app.post('/getUncommitedAmount', asyncMiddleware(async (req, res, next) => {
  const returnValue = await SessionTx.sum('value', { where: { from_address: { $eq: req.body.address }, commited: 0 } });
  res.send(returnValue.toString());
}));

app.post('/endSessionByUser', function (req, res){
  console.log('end ses by user', req.body);
  SessionTx.findOne({where: {session_id: req.body.session_id, from_address: req.body.address}}).then(sessionTx => {
    if (sessionTx) {      
      commitTransaction(sessionTx);      
    };
  });

  res.send('commited');
});

app.post('/endSessionByKp', function (req, res){  
  SessionTx.findAll({where: {session_id: req.body.session_id}}).then(sessionTxs => {
    if(sessionTxs) {
      for (let i=0; i<sessionTxs.length; i++) {
        commitTransaction(sessionTxs[i]);
      }
    }
  });

  res.send('commited');
});

app.get('/isAlive', function (req, res){  
  res.send('alive');
});

function commitTransaction (transaction){
  if (transaction.commited !== 0) {
    //tell ds to close session
    return true;
  }
  const sig = transaction.signature;
  if (!sig) {
    console.error("cannot commit transaction with empty signature", JSON.stringify(transaction, null, 2));
    return false;
  }

  const r = sig.substr(0,66);
  const s = "0x" + sig.substr(66,64);
  const v = new BN(sig.substr(130, 2), 16);
  const intSessionId = transaction.session_id.replace(/-/g, '');
  const eth = getEthGateway();
  eth.commit(
    transaction.from_address,
    transaction.to_address,
    transaction.value,
    intSessionId,
    v,
    r,
    s
  ).then( txHash => {
    console.log('tx hash', txHash);
    transaction.tx_hash = txHash;
    transaction.pending = 1;
    transaction.save();
    notifyParticipant(
      transaction.from_address, 
      transaction.value, 
      'session_confirmation_student', 
      transaction.session_id
    );
  } ).catch (error => {
    console.log(error);
    return false;
  });

  return true;
}

const commitWithdrawTransaction = () => { 
  
    WithdrawTx.findAll({where: { cooldown_expire: {$lt: moment().format('YYYY-MM-DD HH:mm:ss')}, commited: 0, pending: 0, by_user:0 }})  
      .then(wTxs => {
        if (wTxs) {
          wTxs.forEach( wTx => {                      
            const sig = wTx.signature;
            if (!sig) {
              console.error("cannot commit transaction with empty signature", JSON.stringify(wTx, null, 2));
              return false;
            }

            const r = sig.substr(0,66);
            const s = "0x" + sig.substr(66,64);
            const v = new BN(sig.substr(130, 2), 16);
           
            const eth = getEthGateway();          

            eth.commitWithdraw(
              wTx.to_address,
              v,
              r,
              s
            )
              .then( txHash => {
                console.log('tx hash', txHash);            
                wTx.tx_hash = txHash;
                wTx.pending = 1;
                wTx.save();
              })
              .catch (error => {
              console.log(error);
              return false;
            });          
          });
        } else {
          console.log('withdraw records not found');
        }
      })            
    return true;      
}

const commitWithdraws = setInterval(commitWithdrawTransaction, 10000);

app.listen(3100, function () {
  console.log('Quantum payment pool listening on port 3100!')
})

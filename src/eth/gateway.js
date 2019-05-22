import { promiseCallback } from './helpers/callbacks';
import quantumAbi from './abi';
import { SessionTx, WithdrawTx } from '../db_connection';
import { sendTransaction, sendCall } from './helpers/transactions';
import { getBlockStatus } from './';

export default class Gateway {

  watchedTransactions = {};
  withdrawRetries = 2;

  contracts = {}; // cache of contract objects

  constructor(web3, address) {

    this.web3 = web3;
    if (!web3.isAddress(address)) {
      throw new Error('Wrong wallet address');
    }
    this.address = address;
  }

  getTransactionReceipt(txhash) {
    return new Promise((resolve, reject) => {
      this.web3.eth.getTransactionReceipt(txhash, promiseCallback(resolve, reject));
    });
  }

  getBalance(address) {
    this.checkBlockStatus();
    return new Promise((resolve, reject) => {
      this.web3.eth.getBalance(address, promiseCallback(resolve, reject));
    });
  }

  checkPendingTransactions() {
    this.checkBlockStatus();
    SessionTx.findAll({where: {commited: 0, pending: 1}}).then(sessionTxs => {
      if(sessionTxs) {
        sessionTxs.forEach( sessionTx => {
          this.getTransactionReceipt(sessionTx.tx_hash).then(receipt => {
            if (receipt !== null){
              sessionTx.commited = 1;
              sessionTx.pending = 0;
              sessionTx.receipt = JSON.stringify(receipt);
              sessionTx.save();
            }
          });
        })
      }
    });
  }
  
  checkPendingWithdrawTransactions() {
    WithdrawTx.findAll({where: {commited: 0, pending: 1, by_user: 0, receipt: null, tx_hash: {$ne: null}}}).then(withdrawTxs => {
      if(withdrawTxs) {
        withdrawTxs.forEach( withdrawTx => {
          this.getTransactionReceipt(withdrawTx.tx_hash).then(receipt => {
            if (receipt !== null){
              this.getWithdrawInfo(withdrawTx.to_address).then(deposit => {
                if(parseInt(deposit[0].toString()) == 0) {
                  withdrawTx.commited = 1;
                  withdrawTx.pending = 0;
                  withdrawTx.retries = 0;
                  withdrawTx.receipt = JSON.stringify(receipt);
                } else {
                  withdrawTx.retries += 1;
                  withdrawTx.commited = 0;
                  withdrawTx.pending = 0;
                  withdrawTx.tx_hash = null;
                  withdrawTx.receipt = null;
                  if (parseInt(withdrawTx.retries) >= this.withdrawRetries) {
                    withdrawTx.by_user = 1;
                  }
                }
                withdrawTx.save();
              })
            }
          });
        })
      }
    });
  }

  getTxDefaults() {
    return {
      from: this.address,
    };
  }

  getQuantumContractAt(addr) {
    if (this.contracts[addr]) {
      return this.contracts[addr];
    }

    const QuantumContract = this.web3.eth.contract(quantumAbi);
    this.contracts[addr] = QuantumContract.at(addr);

    return this.contracts[addr];
  }

  commit(fromAddress, toAddress, value, sessionId, v, r, s) {
    this.checkBlockStatus();
    const args = [
      fromAddress,
      toAddress,
      value,
      sessionId,
      v,
      r,
      s,
      {
        ...this.getTxDefaults(),
        gas: 2000000,
      },
    ];

    return sendTransaction(
      this.getQuantumContractAt(process.env.CONTRACT_ADDRESS).commit,
      args
    ).then(txobj => txobj.txhash);
  }

  commitCall(fromAddress, toAddress, value, sessionId, v, r, s) {
    const args = [
      fromAddress,
      toAddress,
      value,
      sessionId,
      v,
      r,
      s,
      {
        ...this.getTxDefaults(),
        gas: 2000000,
      },
    ];

    return sendCall(
      this.getQuantumContractAt(process.env.CONTRACT_ADDRESS).commit,
      args
    );
  }

  getPlatform() {
    return this.address;
  }

  getWithdrawTimeLimit()
  {
    this.checkBlockStatus();
    try {
    const args = [
      {
        ...this.getTxDefaults(),
        gas: 2000000,
      },
    ];

    return sendCall(
      this.getQuantumContractAt(process.env.CONTRACT_ADDRESS).withdrawTimeLimit,
      args
    );
    } catch (err) {
        console.log(err);
    }
  }

  getWithdrawInfo(address)
  {
    this.checkBlockStatus();
    return new Promise((resolve, reject) => {
      this.getQuantumContractAt(process.env.CONTRACT_ADDRESS).getWithdrawInfo.call(
        address,
        {},
        promiseCallback(resolve, reject)
      );
    });
  }

  changeWithdrawTimeLimit(newTimeLimit)
  {
    this.checkBlockStatus();
    const args = [
      newTimeLimit,
      {
        from: this.address,
        gas: 2000000,
      },
    ];

    return sendTransaction(
      this.getQuantumContractAt(process.env.CONTRACT_ADDRESS).changeWithdrawLimit,
      args
    ).then(txobj => txobj.txhash);
  }

  commitWithdraw(toAddress, v, r, s) {
    this.checkBlockStatus();
    const args = [
      toAddress,
      v,
      r,
      s,
      {
        ...this.getTxDefaults(),
        gas: 2000000,
      },
    ];

    return sendTransaction(
      this.getQuantumContractAt(process.env.CONTRACT_ADDRESS).autoWithdraw,
      args
    ).then(txobj => txobj.txhash);
  }

  getDeposit (address) {
    return new Promise((resolve, reject) => {
      this.getQuantumContractAt(process.env.CONTRACT_ADDRESS).getDeposit.call(
        address,
        {},
        promiseCallback(resolve, reject)
      );
    });
  }
  
  checkBlockStatus() {
    const status = getBlockStatus();
    try { 
      if (!status.isConnectivity) {
        throw new Error('Network connectivity error detected');
      }
    } catch(err) {
      console.log(err);
    }
  }
}
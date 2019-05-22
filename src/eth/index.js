import Web3 from 'web3';
import EthereumGateway from './gateway';
import HDWalletProvider from 'truffle-hdwallet-provider';
import dotenv from 'dotenv';

let d = require('domain').create();
let ethereum = null;
let connectivity = true;
let blockNb = 0;
//let provider = null;
dotenv.config();

d.on('error', function(e) {
  console.log(e);
});

export function connectHDWallet(keystore) {
  d.run(function() {
    const provider = new HDWalletProvider(process.env.MNEMONIC, process.env.NODE_URL);
    provider.engine.on('error', function(err){
      console.log('HDWalletProvider Network Connectivity Error');
      connectivity = false;
    });

    const web3 = new Web3();
    web3.setProvider(provider);
    ethereum = new EthereumGateway(web3, web3.currentProvider.address);

    provider.engine.on('block', function(block){
      //console.log('BLOCK CHANGED:', '#'+block.number.toString('hex'), '0x'+block.hash.toString('hex'))
      blockNb = block.number.toString('hex');
      connectivity = true;
      ethereum.checkPendingTransactions();
      ethereum.checkPendingWithdrawTransactions();
    });   
    return ethereum;
  });
}

export function getBlockStatus() {
  return { 
    'blockNumber': blockNb,
    'isConnectivity': connectivity
  }
}
export function getEthGateway() {
  return ethereum;
}
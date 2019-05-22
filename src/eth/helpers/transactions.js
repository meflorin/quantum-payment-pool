import BigNumber from 'bignumber.js';
//import config from 'config';
import { getEthGateway } from '../';
import { promiseCallback } from './callbacks';
let gasPriceCached = null;

export function isResultZero(result) {
  return result === '0x' || new BigNumber(Number(result, 16), 16).eq(0);
}

export function logOnFailure(logTag, successTest = res => !isResultZero(res)) {
  return simulatedResult => {
    if (!successTest(simulatedResult)) {
      console.error(
        `${logTag}: The simulated result (${simulatedResult}) might indicate an error.`
      );
    }
    return simulatedResult;
  };
}

export function errorOnFailure(logTag, successTest = res => !isResultZero(res)) {
  return simulatedResult => {
    if (!successTest(simulatedResult)) {
      throw new Error(`${logTag}: Simulated transaction result was unsuccessful.`);
    }
    return simulatedResult;
  };
}

export function getGasPrice() {
  return new Promise((resolve, reject) => {
    if (gasPriceCached) return resolve(gasPriceCached);

    return getEthGateway().web3.eth.getGasPrice(promiseCallback(resolve, reject));
  }).then(gasPrice => {
    gasPriceCached = gasPrice;
    return gasPriceCached;
  });
}

export function callAndSendTransaction(
  contractFunction,
  argsParam,
  predictSuccess = errorOnFailure('')
) {
  const args = argsParam;
  return getGasPrice()
    .then(gasPrice => {
      gasPriceCached = gasPrice;

      args[args.length - 1].gasPrice = gasPrice;
      return new Promise((resolve, reject) => {
        if (false){//config.eth.callBeforeTransaction) {
          const callArgs = args.concat(promiseCallback(resolve, reject));
          contractFunction.call(...callArgs);
        } else {
          resolve(new BigNumber(1));
        }
      });
    })
    .then(predictSuccess)
    .then(simulatedResult =>
      new Promise((resolve, reject) => {
        const sendArgs = args.concat(promiseCallback(resolve, reject));
        contractFunction.sendTransaction(...sendArgs);
      }).then(txhash => {
        return { txhash, simulatedResult };
      })
    );
}

export function sendTransaction(contractFunction, argsParam) {
  return getGasPrice().then(gasPrice => {
    const args = argsParam;
    args[args.length - 1].gasPrice = gasPrice;

    return new Promise((resolve, reject) => {
      const sendArgs = args.concat(promiseCallback(resolve, reject));
      contractFunction.sendTransaction(...sendArgs);
    }).then(txhash => {
      return { txhash };
    });
  });
}

export function sendCall(contractFunction, argsParam) {
    return getGasPrice().then(gasPrice => {
      const args = argsParam;
      args[args.length - 1].gasPrice = gasPrice;
  
      return new Promise((resolve, reject) => {
        const sendArgs = args.concat(promiseCallback(resolve, reject));
        contractFunction.call(...sendArgs);
      }).then(txhash => {
        return { txhash };
      });
    });
  }

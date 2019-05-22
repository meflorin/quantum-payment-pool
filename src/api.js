import axios from 'axios';
var crypto = require('crypto');

export const axiosApiInstance = axios.create({  
  baseURL: process.env.API_URL,
  xsrfCookieName: null,
});

export function getPublicKey(address) {     
  let hash = crypto.createHmac('sha256', process.env.API_KEY).update(address).digest('hex');    

  axiosApiInstance.defaults.headers = {
    'x-pp': hash
  };  
  
  return axiosApiInstance
    .post('/api/user/get-public-key', {       
      address     
    })
    .catch(response => {
      throw  response;
    });
  
}

export function notifyParticipant(address, value, type, session, participants = 0) {

  return axiosApiInstance
    .post('/api/user/send-pp-email', {  
      address,
      value,
      type,
      session,
      participants   
    })
    .catch(response => {
      throw  response;
    });
  
}
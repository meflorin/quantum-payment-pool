export function promiseCallback(resolve, reject) { //eslint-disable-line
  return (error, result) => {
    if (error) {
      reject(error);
    } else {
      resolve(result);
    }
  };
}

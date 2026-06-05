import restApi, { getToken as getRestToken, setToken as setRestToken } from './restApi';
import firebaseApi, { getToken as getFirebaseToken, setToken as setFirebaseToken } from './firebaseApi';

const provider = import.meta.env.VITE_DATA_PROVIDER || 'rest';
const usingFirebase = provider === 'firebase';

const api = usingFirebase ? firebaseApi : restApi;

function getToken() {
  return usingFirebase ? getFirebaseToken() : getRestToken();
}

function setToken(token) {
  return usingFirebase ? setFirebaseToken(token) : setRestToken(token);
}

export { setToken, getToken };
export default api;

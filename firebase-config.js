const firebaseConfig = {
  apiKey: "AIzaSyDOOkx9CG8i_WMxNKaFyPsIs7JEqRaJppA",
  authDomain: "gateway-sites-schedule.firebaseapp.com",
  databaseURL: "https://gateway-sites-schedule-default-rtdb.firebaseio.com",
  projectId: "gateway-sites-schedule",
  storageBucket: "gateway-sites-schedule.firebasestorage.app",
  messagingSenderId: "302699650359",
  appId: "1:302699650359:web:db43dfad9c5e4b99b34eb2"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
const storage = firebase.storage();

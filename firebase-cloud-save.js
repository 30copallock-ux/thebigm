// Firebase cloud save bridge for the compiled Defold HTML5 build.
// Requires Anonymous sign-in and Cloud Firestore enabled in Firebase Console.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDKg7TP83hAuvL0ALnDMJmG7OwOJbxzRLI",
  authDomain: "monkeemart-5299f.firebaseapp.com",
  projectId: "monkeemart-5299f",
  storageBucket: "monkeemart-5299f.firebasestorage.app",
  messagingSenderId: "612936330828",
  appId: "1:612936330828:web:de45e40e27dc651ca9cee9",
  measurementId: "G-FCK8N5SY72"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const MAX_BYTES = 700000; // avoid oversized Firestore documents

function waitForUser() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Firebase sign-in timed out")), 15000);
    const unsub = onAuthStateChanged(auth, user => {
      if (user) { clearTimeout(timer); unsub(); resolve(user); }
    }, err => { clearTimeout(timer); unsub(); reject(err); });
    if (!auth.currentUser) signInAnonymously(auth).catch(err => {
      clearTimeout(timer); unsub(); reject(err);
    });
  });
}
const userPromise = waitForUser();
const saveRef = async () => doc(db, "monkeyMartSaves", (await userPromise).uid);

function listFiles(FS, root, current = root, out = []) {
  let names;
  try { names = FS.readdir(current); } catch (_) { return out; }
  for (const name of names) {
    if (name === "." || name === "..") continue;
    const full = current.replace(/\/$/, "") + "/" + name;
    try {
      const stat = FS.stat(full);
      if (FS.isDir(stat.mode)) listFiles(FS, root, full, out);
      else {
        const bytes = FS.readFile(full);
        // Save as base64, with paths relative to the persistent root.
        let binary = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        out.push({ path: full.slice(root.length).replace(/^\//, ""), data: btoa(binary) });
      }
    } catch (e) { console.warn("Could not read save file", full, e); }
  }
  return out;
}
function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

window.FirebaseCloudSaveReady = userPromise.then(() => ({
  async saveFromFS(FS, root) {
    const files = listFiles(FS, root);
    const payload = JSON.stringify(files);
    if (payload.length > MAX_BYTES) {
      console.warn("Cloud save skipped: save data is too large for this Firestore document.");
      return;
    }
    await setDoc(await saveRef(), { files, updatedAt: serverTimestamp(), format: 1 });
    console.info("Monkey Mart cloud save uploaded.");
  },
  async restoreIntoFS(FS, root) {
    const snap = await getDoc(await saveRef());
    if (!snap.exists()) return false;
    const files = snap.data().files;
    if (!Array.isArray(files)) return false;
    for (const item of files) {
      if (!item || typeof item.path !== "string" || typeof item.data !== "string") continue;
      // Reject paths that could escape the persistent save directory.
      if (item.path.startsWith("/") || item.path.split("/").some(part => part === ".." || part === "")) continue;
      const full = root.replace(/\/$/, "") + "/" + item.path;
      const parts = full.split("/");
      let dir = "";
      for (let i = 1; i < parts.length - 1; i++) {
        dir += "/" + parts[i];
        try { FS.mkdir(dir); } catch (_) {}
      }
      FS.writeFile(full, decodeBase64(item.data));
    }
    console.info("Monkey Mart cloud save restored.");
    return true;
  }
}));

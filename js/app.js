/* ---------- Firebase SDK (v12) ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, signOut,
  GoogleAuthProvider, signInWithPopup, setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc,
  collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs, where, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

/* ---------- Config (your existing project) ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyBxurHaOTmFeO0FXmSuSfrYS-YKoa0joGw",
  authDomain: "brainquest1209.firebaseapp.com",
  projectId: "brainquest1209",
  storageBucket: "brainquest1209.firebasestorage.app",
  messagingSenderId: "332228577073",
  appId: "1:332228577073:web:9b9e28fb88dae6b4145210"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

/* ---------- Persistence (important) ---------- */
try {
  await setPersistence(auth, browserLocalPersistence);
  console.log("[Auth] Persistence set to browserLocalPersistence");
} catch (e) {
  console.warn("[Auth] Could not set persistence:", e);
}

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
function show(id){
  document.querySelectorAll('section').forEach(s=>{
    s.classList.remove('active');
    s.style.display = 'none';
    s.style.opacity = '0';
  });
  const target = $(id);
  target.style.display = 'flex';
  requestAnimationFrame(()=>{ target.style.opacity = '1'; target.classList.add('active'); });

  if(id === "quiz" && auth.currentUser){
    fetchLastFive();
  }
}
function msg(text){ $("auth-msg").textContent = text || ""; }
function dbg(...args){ console.log("[DBG]", ...args); }

/* ---------------- Dynamic config ---------------- */
const RAW_BASE = "https://raw.githubusercontent.com/singla1209/Quizzy/main/";
const API_BASE = "https://api.github.com/repos/singla1209/Quizzy/contents/";

const SUBJECTS = [
  { key:"science", label:"Science",          dynamic:true, path:"Data/science/" },
  { key:"math",    label:"Mathematics",      dynamic:true, path:"Data/math/" },
  { key:"eng",     label:"English",          dynamic:true, path:"Data/english/" },
  { key:"sst",     label:"Social Science",   dynamic:true, path:"Data/sst/" },
  { key:"cs",      label:"Computer Science", dynamic:true, path:"Data/cs/" }
];

/* NCERT 2025–26 pretty names (ONLY for science & math) */
const CHAPTER_TITLES = {
  science: {
    1: "Chemical Reactions and Equations",
    2: "Acids, Bases and Salts",
    3: "Metals and Non-metals",
    4: "Carbon and its Compounds",
    5: "Life Processes",
    6: "Control and Coordination",
    7: "How do Organisms Reproduce?",
    8: "Heredity and Evolution",
    9: "Light – Reflection and Refraction",
    10: "The Human Eye and the Colourful World",
    11: "Electricity",
    12: "Magnetic Effects of Electric Current",
    13: "Our Environment (or Natural Resources)"
  },
  math: {
    1: "Real Numbers",
    2: "Polynomials",
    3: "Pair of Linear Equations in Two Variables",
    4: "Quadratic Equations",
    5: "Arithmetic Progressions",
    6: "Triangles",
    7: "Coordinate Geometry",
    8: "Introduction to Trigonometry",
    9: "Applications of Trigonometry",
    10: "Circles",
    11: "Areas Related to Circles",
    12: "Surface Areas and Volumes",
    13: "Statistics",
    14: "Probability"
  }
};

/* ---------- Utility ---------- */
function titleFromFilename(filename){
  const base = filename.replace(/\.json$/i,'').replace(/[_\-]+/g,' ').trim();
  return base.replace(/\s+/g,' ')
    .split(' ')
    .map(w=>w ? w[0].toUpperCase()+w.slice(1) : '')
    .join(' ');
}

function prettifyChapterName(filename, subjectKey){
  const isPrettySubject = subjectKey === "science" || subjectKey === "math";
  if (isPrettySubject){
    const m = filename.match(/chapter\s*(\d+)/i);
    if (m){
      const n = parseInt(m[1],10);
      const map = CHAPTER_TITLES[subjectKey] || {};
      const pretty = map[n];
      if (pretty) return `Chapter ${n}: ${pretty}`;
      return `Chapter ${n}`;
    }
    return titleFromFilename(filename);
  } else {
    const m = filename.match(/chapter\s*(\d+)/i);
    if (m){
      const n = parseInt(m[1],10);
      return `Chapter ${n}`;
    }
    return titleFromFilename(filename);
  }
}

async function listChapters(path, subjectKey) {
  const res = await fetch(API_BASE + path, { cache: "no-store" });
  if (!res.ok) throw new Error("GitHub API error");
  const items = await res.json();

  let files = items.filter(x => x.type === "file" && x.name.toLowerCase().endsWith(".json"));

  // 🔹 Group by base chapter (ignore _levelX)
  const chapterMap = {};
  for (const f of files) {
    const match = f.name.match(/(chapter\d+)/i);
    if (match) {
      const base = match[1]; // e.g. "chapter1"
      if (!chapterMap[base]) {
        chapterMap[base] = {
          ...f,
          prettyTitle: prettifyChapterName(f.name, subjectKey),
          basePath: path,   // folder path for fetching levels later
          chapterBase: base // store "chapter1" etc.
        };
      }
    }
  }

  // 🔹 Convert back to array and sort
  const chapters = Object.values(chapterMap).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );

  return chapters;
}


function shuffle(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}


/* ---------- State ---------- */
let userName = "";
let userId   = null;
let subject  = null;
let currentChapterTitle = "";
let questions = [];
let idx = 0, correct = 0, incorrect = 0, responses = [];
let quizStartMs = null;

/* 🔹 NEW STATE for multi-level */
let currentLevel = null;
let currentGhPath = null;

/* Build subject buttons */
const list = $("subject-list");
SUBJECTS.forEach(s => {
  const btn = document.createElement("button");
  btn.className = "btn subject";
  btn.textContent = s.label;
  btn.onclick = () => startSubject(s);
  list.appendChild(btn);
});
/* ---------- Auth actions ---------- */
$("login-btn").onclick = async () => {
  msg();
  let id = $("login-id").value.trim();
  const pass = $("login-pass").value;
  if(!id || !pass){ msg("Enter email/mobile and password."); return; }
  if(!id.includes("@")) id += "@mobile.com";
  try {
    dbg("Attempt login with:", id);
    const cred = await signInWithEmailAndPassword(auth, id, pass);
    dbg("Login success:", { uid: cred.user.uid, email: cred.user.email });
    msg(""); // clear any previous message
  } catch(e){
    console.error("Login error:", e);
    msg(humanAuthError(e));
  }
};

$("google-btn").onclick = async () => {
  msg();
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    await setDoc(doc(db, "users", cred.user.uid), {
      name: cred.user.displayName || "",
      emailOrMobile: cred.user.email || "",
      createdAt: serverTimestamp()
    }, { merge:true });
    dbg("Google sign-in ok:", { uid: cred.user.uid, email: cred.user.email });
  } catch(e){ 
    console.error("Google sign-in error:", e);
    msg(humanAuthError(e)); 
  }
};

$("signup-btn").onclick = async () => {
  msg();
  const name = $("signup-name").value.trim();
  let id = $("signup-id").value.trim();
  const pass = $("signup-pass").value;
  if(!name || !id || !pass){ msg("Fill all sign up fields."); return; }
  const rawId = id;
  if(!id.includes("@")) id += "@mobile.com";
  try {
    // If already logged in as someone else, sign out first to avoid stale session
    if(auth.currentUser){
      dbg("Signing out current user before signup:", auth.currentUser.email);
      await signOut(auth);
    }
    dbg("Attempt signup with:", id);
    const cred = await createUserWithEmailAndPassword(auth, id, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      name, emailOrMobile: rawId, createdAt: serverTimestamp()
    }, { merge:true });
    dbg("Signup success:", { uid: cred.user.uid, email: cred.user.email });
    msg(""); // clear info
  } catch(e){
    console.error("Signup error:", e);
    msg(humanAuthError(e));
  }
};

$("logout-1").onclick = () => signOut(auth).catch(e=>console.error("Logout error:", e));
$("logout-2").onclick = () => signOut(auth).catch(e=>console.error("Logout error:", e));

onAuthStateChanged(auth, async (user) => {
  if(user){
    dbg("onAuthStateChanged → logged in as:", user.email, user.uid);
    userId = user.uid;
    userName = user.displayName || "";
    if(!userName){
      try {
        const snap = await getDoc(doc(db,"users",user.uid));
        userName = (snap.exists() && snap.data().name) ? snap.data().name : (user.email || "User");
      } catch(e){
        userName = user.email || "User";
      }
    }
    $("hello").textContent = `Hi ${userName}!`;

    // ensure subject list is present (in case UI built earlier removed it)
    if($("subject-list").children.length === 0){
      SUBJECTS.forEach(s => {
        const btn = document.createElement("button");
        btn.className = "btn subject";
        btn.textContent = s.label;
        btn.onclick = () => startSubject(s);
        $("subject-list").appendChild(btn);
      });
    }

    show("subjects");
    fetchLastFive();
  }else{
    dbg("onAuthStateChanged → no user");
    userId = null;
    $("login-pass").value = "";
    $("signup-pass").value = "";
    show("auth");
  }
});

/* ---------- Quiz + Dynamic Chapters ---------- */
async function startSubject(s) {
  subject = s;
  $("chapter-list").innerHTML = "Loading...";
  const items = await listChapters(s.path, s.key); // ✅ pass subject key for pretty names

  $("chapter-list").innerHTML = ""; // reset
  items.forEach(file => {
    const btn = document.createElement("button");
    btn.className = "btn chapter";
    btn.textContent = file.prettyTitle;   // ✅ already prepared in listChapters
    btn.onclick = () => startChapterQuiz(file, file.prettyTitle);  // ✅ pass whole chapter object
    $("chapter-list").appendChild(btn);
  });

  $("chapter-list").style.display = "grid";
  $("level-list").style.display = "none";
  $("back-to-chapters").style.display = "none";
  show("chapters");
}



/* 🔹 UPDATED: show levels */

async function startChapterQuiz(chapter, prettyTitle) {
  currentChapterTitle = prettyTitle;
  $("chapter-list").style.display = "none";   // hide chapters
  $("level-list").style.display = "block";    // show levels
  $("level-list").innerHTML = "";

  let progress = {};
  try {
    // --- Read progress from: progress/{userId}/chapters/{chapterDocId}
    let chapterDocId = `${chapter.basePath}${chapter.chapterBase}.json`.replace(/\//g, "_");
    const progressRef = doc(db, "progress", userId, "chapters", chapterDocId);
    console.log("Reading progress from:", progressRef.path);
    const snap = await getDoc(progressRef);
    if (snap.exists()) progress = snap.data();
  } catch (err) {
    console.warn("No progress yet or read failed:", err);
  }

  for (let i = 1; i <= 5; i++) {
    const levelKey = `level${i}`;
    const status = progress[levelKey] || (i === 1 ? "unlocked" : "locked");

    const btn = document.createElement("button");
    btn.className = "btn";

    if (status === "locked") {
      btn.innerHTML = `Level ${i} <span class="lock">🔒</span>`;
      btn.disabled = true;
      btn.classList.add("locked");
    } else {
      btn.textContent = `Level ${i}`;
      btn.onclick = () => {
        const url = `${RAW_BASE}${chapter.basePath}${chapter.chapterBase}_level${i}.json`;
        console.log("Fetching questions from:", url);
        beginQuizFromUrl(
          url,
          subject.label,   // ✅ subject label (Science, Math, etc.)
          prettyTitle,
          i,
          `${chapter.basePath}${chapter.chapterBase}.json`
        );
      };
    }
    $("level-list").appendChild(btn);
  }

  show("chapters");
}

/* 🔹 MODIFIED signature */
async function beginQuizFromUrl(url, subjectLabel, chapterTitle, level=null, ghPath=null){
  currentLevel = level;
  currentGhPath = ghPath;
  idx = 0; correct = 0; incorrect = 0; responses = [];
  quizStartMs = null;
  $("stats").textContent = `✅ Correct: 0  |  ❌ Incorrect: 0`;
  $("qprogress").textContent = `Question 1/1`;
  $("bar-inner").style.width = "0%";
  $("end-screen").style.display = "none";

  $("welcome-banner").innerHTML =
    `Welcome <span class="name">${userName}</span> in BrainQuest of <b>‘${subjectLabel}’ : ${chapterTitle.replace(/^Chapter\s*\d+\s*:\s*/i,'')}</b>`;

  show("quiz");

  try{
    const res = await fetch(url, {cache:"no-store"});
    const raw = await res.json();
    questions = Array.isArray(raw) ? raw.slice() : [];
  }catch(e){ 
    console.error("Fetch questions error:", e);
    questions = []; 
  }

  if(!questions.length){
    $("question").textContent = "Could not load questions.";
    $("options").innerHTML = "";
    fetchLastFive();
    return;
  }

  shuffle(questions);

  questions = questions.map(q => {
    const entries = Object.entries(q.options || {}).map(([key,text]) => ({key, text}));
    shuffle(entries);
    return { ...q, _optionsArr: entries, _correctKey: q.correct };
  });

  renderQuestion();
  fetchLastFive();
}

/* ---------- Rest of quiz flow (renderQuestion, choose, finishQuiz, etc.) ---------- */
// Keep all your existing functions here…
function renderQuestion(){
  const q = questions[idx];
  $("question").textContent = `Q${idx+1}. ${q.question}`;
  const optionsDiv = $("options");
  optionsDiv.innerHTML = "";

  q._optionsArr.forEach(opt=>{
    const div = document.createElement("div");
    div.className = "option";
    div.textContent = opt.text;
    div.onclick = () => choose(opt.key, div);
    optionsDiv.appendChild(div);
  });

  $("qprogress").textContent = `Question ${idx+1}/${questions.length}`;
  $("bar-inner").style.width = `${((idx)/questions.length)*100}%`;
  if(quizStartMs === null) quizStartMs = Date.now();
}

function choose(selectedKey, el){
  document.querySelectorAll(".option").forEach(o => o.style.pointerEvents = "none");
  const q = questions[idx];
  const correctKey = q._correctKey;

  document.querySelectorAll(".option").forEach(o=>{
    const isCorrect = q._optionsArr.find(x => x.text === o.textContent)?.key === correctKey;
    if(isCorrect) o.classList.add("correct");
  });
  if(selectedKey !== correctKey) el.classList.add("wrong");

  const selectedObj = q._optionsArr.find(x=>x.key===selectedKey);
  const correctObj  = q._optionsArr.find(x=>x.key===correctKey);
  const selectedAnswer = selectedObj ? selectedObj.text : "No answer";
  const correctAnswer  = correctObj  ? correctObj.text  : "";

  responses.push({ question: q.question, selected: selectedAnswer, correct: correctAnswer });

  if(selectedKey === correctKey){ correct++; $("correct-sound").play(); }
  else { incorrect++; $("wrong-sound").play(); }

  $("stats").textContent = `✅ Correct: ${correct}  |  ❌ Incorrect: ${incorrect}`;
  $("bar-inner").style.width = `${((idx+1)/questions.length)*100}%`;

  setTimeout(()=>{
    if(idx < questions.length-1){ idx++; renderQuestion(); }
    else { finishQuiz(); }
  }, 900);
}
function secsToText(s){
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s/60);
  const r = s%60;
  return `${m}m ${r}s`;
}
function toMillis(df){
  if(!df) return 0;
  if(typeof df.toDate === "function") return df.toDate().getTime();
  return new Date(df).getTime() || 0;
}

async function finishQuiz(){
  $("question").textContent = "All done!";
  $("options").innerHTML = "";
  $("end-screen").style.display = "block";
  $("end-screen").innerHTML = `<h3>Score: ${correct} / ${questions.length}</h3>`;

  const timeTakenSec = quizStartMs ? (Date.now() - quizStartMs)/1000 : 0;

  try{
    const current = auth.currentUser;
    await addDoc(collection(db, "quiz_results"), {
      name: (userName || current?.displayName || ""),
      score: correct,
      totalQuestions: questions.length,
      correctAnswers: correct,
      incorrectAnswers: questions.length - correct,
      responses: responses,
      date: serverTimestamp(),
      subject: subject ? `${subject.label} : ${currentChapterTitle}` : null,
      userId: current ? current.uid : null,
      userEmail: current ? current.email : null,
      timeTakenSec: Math.round(timeTakenSec)
    });
    fetchLastFive();
  }catch(e){
    console.error("Save failed:", e);
  }

  /* 🔹 Unlock next level */
  try {
   if (currentLevel && currentGhPath) {
  try {
    // sanitize ghPath to avoid slashes in doc ID
    let chapterDocId = String(currentGhPath).replace(/\//g, "_");
    // normalize → remove "_levelX.json" so all levels save into the same chapter doc
    chapterDocId = chapterDocId.replace(/_level\d+\.json$/i, "");


    // path: progress/{userId}/chapters/{chapterDocId}
    const ref = doc(db, "progress", userId, "chapters", chapterDocId);

    const snap = await getDoc(ref);
    let progress = snap.exists() ? snap.data() : {};

    // mark current level as completed
    progress[`level${currentLevel}`] = "completed";

    // unlock next level if exists
    if (currentLevel < 5) {
      progress[`level${currentLevel+1}`] = "unlocked";
    }

    // merge to keep old values
    await setDoc(ref, progress, { merge: true });
    console.log("Progress saved to:", ref.path, progress);

  } catch (err) {
    console.error("Progress update failed:", err);
  }
}


  } catch (err) {
    console.error("Progress update failed:", err);
  }

  const pct = questions.length ? (correct / questions.length) * 100 : 0;
  launchCelebration(Math.round(pct));
}

/* ---------- Last 5 results, modal, celebration, etc. ---------- */
// Keep your existing code unchanged…

/* second update of fetch last five result and show delete button in admin only */

async function fetchLastFive() {
  const body = $("last5-body");
  const current = auth.currentUser;

  if (!current) {
    body.innerHTML = `<tr><td class="muted" colspan="6">Please log in to see results.</td></tr>`;
    return;
  }

  body.innerHTML = `<tr><td class="muted" colspan="6">Loading…</td></tr>`;

  try {
    // 🔹 Check admin claim
    const idTokenResult = await current.getIdTokenResult(true);
    const isAdmin = !!idTokenResult.claims.admin;

    // 🔹 Handle table header for delete column
    const headerRow = document.getElementById("results-header");
    let deleteHeader = document.getElementById("delete-header");
    if (isAdmin) {
      if (!deleteHeader) {
        deleteHeader = document.createElement("th");
        deleteHeader.id = "delete-header";
        deleteHeader.textContent = "Delete";
        headerRow.appendChild(deleteHeader);
      }
    } else {
      if (deleteHeader) deleteHeader.remove();
    }

    let q;
    if (isAdmin) {
      // Admin → fetch all results
      q = query(
        collection(db, "quiz_results"),
        orderBy("date", "desc"),
        limit(50)
      );
    } else {
      // Normal user → only their own results
      q = query(
        collection(db, "quiz_results"),
        where("userId", "==", current.uid),
        orderBy("date", "desc"),
        limit(50)
      );
    }

    const snap = await getDocs(q);

    // Build list of results with doc.id included
    const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (!list.length) {
      body.innerHTML = `<tr><td class="muted" colspan="${isAdmin ? 7 : 6}">No results yet. Finish a quiz to see it here.</td></tr>`;
      return;
    }

    // Sort + take top 5
    list.sort((a, b) => toMillis(b.date) - toMillis(a.date));
    const top5 = list.slice(0, 5);

    body.innerHTML = "";
    top5.forEach(d => {
      const dt = d.date?.toDate ? d.date.toDate() : (d.date ? new Date(d.date) : null);
      const dtTxt = dt ? dt.toLocaleString() : "";
      const total = Number(d.totalQuestions) || 0;
      const corr  = Number(d.correctAnswers) || 0;
      const inc   = Number(d.incorrectAnswers) || Math.max(0, total - corr);
      const secs  = Number(d.timeTakenSec) || 0;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${dtTxt}</td>
        <td>${d.subject || "N/A"}</td>
        <td>${d.name || ""}</td>
        <td>${corr}</td>
        <td>${inc}</td>
        <td>${secsToText(secs)}</td>
        ${isAdmin ? `<td><button class="deleteBtn" data-id="${d.id}"><img src="https://img.icons8.com/ios-glyphs/30/000000/trash--v1.png" alt="Delete" style="width:20px;height:20px;cursor:pointer;" /></button></td>` : ""}
      `;
      tr.onclick = () => openModalForResult(d);
      body.appendChild(tr);
    });

    // Attach delete handlers (only for admin)
    if (isAdmin) {
      document.querySelectorAll(".deleteBtn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation(); // prevent row click opening modal
          const id = btn.dataset.id;
          if (confirm("Are you sure you want to delete this result?")) {
            try {
              await deleteDoc(doc(db, "quiz_results", id));
              alert("Result deleted!");
              fetchLastFive(); // refresh table
            } catch (err) {
              console.error("Delete failed", err);
              alert("Delete failed: " + err.message);
            }
          }
        });
      });
    }

  } catch (err) {
    console.error(err);
    body.innerHTML = `<tr><td class="muted" colspan="6">Couldn't load results.</td></tr>`;
  }
}
/* ---------- Modal helpers ---------- */
function openModalForResult(data){
  const content = $("modal-content");
  const dt = data.date?.toDate ? data.date.toDate().toLocaleString() :
             (data.date ? new Date(data.date).toLocaleString() : "");
  const total = Number(data.totalQuestions)||0;
  const corr  = Number(data.correctAnswers)||0;
  const secs  = Number(data.timeTakenSec)||0;

  let html = `
    <h3 style="margin:0 24px 6px 6px;text-align:left">
      ${data.subject || "Result"} 
      <span class="tag">${dt}</span>
    </h3>
    <p class="muted" style="text-align:left;margin:0 0 10px 6px">
      Name: <b>${data.name||""}</b> &nbsp; • &nbsp; Score: <b>${corr}/${total}</b> &nbsp; • &nbsp; Time: <b>${secsToText(secs)}</b>
    </p>
  `;

  if(Array.isArray(data.responses) && data.responses.length){
    data.responses.forEach((r,i)=>{
      html += `
        <div class="qrow">
          <div class="q">Q${i+1}. ${r.question || ""}</div>
          <div>Attempted: <b>${r.selected || ""}</b></div>
          <div>Correct: <b>${r.correct || ""}</b></div>
        </div>
      `;
    });
  }else{
    html += `<div class="qrow">No response details saved.</div>`;
  }

  content.innerHTML = html;
  $("modal-overlay").style.display = "flex";
}
$("modal-close").onclick = ()=> $("modal-overlay").style.display = "none";
$("modal-overlay").addEventListener("click", (e)=>{
  if(e.target.id === "modal-overlay") $("modal-overlay").style.display = "none";
});

/* ---------- Errors ---------- */
function humanAuthError(e){
  const code = (e && e.code) ? e.code : "";
  switch(code){
    case "auth/invalid-email": return "Please enter a valid email.";
    case "auth/missing-password": return "Please enter your password.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Invalid email/mobile or password.";
    case "auth/cancelled-popup-request":
    case "auth/popup-closed-by-user": return "Google sign-in was closed. Try again.";
    case "auth/email-already-in-use": return "This email/mobile is already registered. Try logging in.";
    case "auth/weak-password": return "Password should be at least 6 characters.";
    default: return e?.message || "Authentication error.";
  }
}

/* ---------- Nav ---------- */
$("back-to-subjects").onclick = () => {
  $("chapter-list").style.display = "none";
  $("level-list").style.display = "none";
  $("back-to-chapters").style.display = "none";
  show("subjects");
};

$("back-to-subjects-2").onclick = () => {
  $("chapter-list").style.display = "none";
  $("level-list").style.display = "none";
  $("back-to-chapters").style.display = "none";
  show("subjects");
};

/* =======================================================
   Celebration: confetti (canvas), donut, random messages
   ======================================================= */
const confettiCanvas = $("confetti");
const ctxC = confettiCanvas.getContext("2d");
let confettiParticles = [];
let ribbons = [];
let confettiAnimating = false;

const messagesLow = [
  "Every step counts — keep going!",
  "Good try! Let’s push a little more next time!",
  "You’re learning fast — don’t stop!",
  "Progress over perfection!",
  "Nice effort — keep at it!"
];
const messagesMid = [
  "Nice work — you’re getting there!",
  "Solid score! Keep the momentum.",
  "You’re on the right track!",
  "Nice rhythm — consistency wins.",
  "Great effort — aim higher next time!"
];
const messagesHigh = [
  "Outstanding! You’re a star!",
  "Brilliant performance — keep shining!",
  "Fantastic! You nailed it!",
  "Superb — excellence achieved!",
  "Incredible work — way to go!"
];

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function sizeCanvas(){
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
sizeCanvas();
window.addEventListener("resize", sizeCanvas);

function spawnConfetti(count, speedMin, speedMax){
  for(let i=0;i<count;i++){
    confettiParticles.push({
      x: Math.random()*confettiCanvas.width,
      y: -20 - Math.random()*confettiCanvas.height*0.5,
      w: 6 + Math.random()*6,
      h: 10 + Math.random()*10,
      tilt: Math.random()*2*Math.PI,
      tiltSpeed: 0.02 + Math.random()*0.08,
      vy: speedMin + Math.random()*(speedMax-speedMin),
      vx: (Math.random()-0.5)*2,
      color: `hsl(${Math.floor(Math.random()*360)}, 90%, 60%)`
    });
  }
}
function spawnRibbons(count){
  for(let i=0;i<count;i++){
    ribbons.push({
      x: Math.random()*confettiCanvas.width,
      y: -50 - Math.random()*200,
      len: 80 + Math.random()*100,
      amp: 10 + Math.random()*20,
      phase: Math.random()*Math.PI*2,
      vy: 1.2 + Math.random()*2,
      color: `hsl(${Math.floor(Math.random()*360)}, 90%, 60%)`
    });
  }
}

function drawConfetti(){
  ctxC.clearRect(0,0,confettiCanvas.width, confettiCanvas.height);

  // rectangles
  confettiParticles.forEach(p=>{
    p.tilt += p.tiltSpeed;
    p.y += p.vy;
    p.x += p.vx + Math.sin(p.tilt)*0.3;
    ctxC.fillStyle = p.color;
    ctxC.save();
    ctxC.translate(p.x, p.y);
    ctxC.rotate(p.tilt);
    ctxC.fillRect(-p.w/2, -p.h/2, p.w, p.h);
    ctxC.restore();
  });
  confettiParticles = confettiParticles.filter(p => p.y < confettiCanvas.height + 40);

  // ribbons
  ribbons.forEach(r=>{
    r.y += r.vy;
    r.phase += 0.08;
    ctxC.strokeStyle = r.color;
    ctxC.lineWidth = 6;
    ctxC.beginPath();
    for(let t=0;t<r.len;t+=6){
      const xx = r.x + Math.sin(r.phase + t*0.08)*r.amp;
      const yy = r.y + t;
      if(t===0) ctxC.moveTo(xx,yy); else ctxC.lineTo(xx,yy);
    }
    ctxC.stroke();
  });
  ribbons = ribbons.filter(r => r.y < confettiCanvas.height + r.len);

  if(confettiParticles.length || ribbons.length){
    requestAnimationFrame(drawConfetti);
  }else{
    confettiAnimating = false;
  }
}

function startConfetti(level){
  sizeCanvas();
  if(level === "low"){
    spawnConfetti(120, 2, 3.5);
    spawnRibbons(6);
  }else if(level === "mid"){
    spawnConfetti(280, 2.5, 4.2);
    spawnRibbons(10);
  }else{
    spawnConfetti(480, 3, 5);
    spawnRibbons(16);
    for(let i=0;i<4;i++){
      setTimeout(()=>spawnConfetti(120, 3, 5), i*220);
    }
  }
  if(!confettiAnimating){
    confettiAnimating = true;
    drawConfetti();
  }
}

function renderDonut(score, total){
  const c = $("donut");
  const ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);

  const pct = total ? score/total : 0;
  const cx = c.width/2, cy = c.height/2, r = 70, thickness = 22;

  // track
  ctx.lineWidth = thickness;
  ctx.strokeStyle = "rgba(255,255,255,.2)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.stroke();

  // value arc
  let color = "#ffb703";
  if(pct >= 0.8) color = "#00e6b0";
  else if(pct >= 0.5) color = "#5ab0ff";

  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI/2, -Math.PI/2 + pct*2*Math.PI, false);
  ctx.stroke();

  // text
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${Math.round(pct*100)}%`, cx, cy-6);

  ctx.font = "12px Arial";
  ctx.fillStyle = "rgba(255,255,255,.8)";
  ctx.fillText(`${score}/${total}`, cx, cy+14);
}

function launchCelebration(pct){
  let level = "low";
  let m = pickRandom(messagesLow);
  if(pct >= 80){ level = "high"; m = pickRandom(messagesHigh); }
  else if(pct >= 50){ level = "mid"; m = pickRandom(messagesMid); }

  $("celebrate-overlay").style.display = "flex";
  $("big-name").textContent = `${userName || "Great Job!"}`;
  $("motivation").textContent = m;

  renderDonut(correct, questions.length);
  startConfetti(level);
}

$("celebrate-close").onclick = () => {
  $("celebrate-overlay").style.display = "none";
};
$("play-again-btn").onclick = () => {
  $("celebrate-overlay").style.display = "none";
  show("subjects");
};

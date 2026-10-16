const $ = (s) => document.querySelector(s);

const els = {
  startBtn: $("#startBtn"), startBtnText: $("#startBtnText"), cancelBtn: $("#cancelBtn"),
  gaugeValue: $("#gaugeValue"), gaugeLabel: $("#gaugeLabel"), gaugeArc: $("#gaugeArc"),
  phaseLabel: $("#phaseLabel"), liveHint: $("#liveHint"), progressBar: $("#progressBar"),
  serverPill: $("#serverPill"),
  dlValue: $("#dlValue"), dlSub: $("#dlSub"), dlMeter: $("#dlMeter"), dlBadge: $("#dlBadge"),
  ulValue: $("#ulValue"), ulSub: $("#ulSub"), ulMeter: $("#ulMeter"), ulBadge: $("#ulBadge"),
  pingValue: $("#pingValue"), pingSub: $("#pingSub"), jitterValue: $("#jitterValue"), serverValue: $("#serverValue"),
  verdictPill: $("#verdictPill"), verdictText: $("#verdictText"), verdictList: $("#verdictList"),
  dServer: $("#dServer"), dIp: $("#dIp"), dDuration: $("#dDuration"), dData: $("#dData"), dTime: $("#dTime"),
  copyBtn: $("#copyBtn"), shareBtn: $("#shareBtn"), copyFeedback: $("#copyFeedback"),
  historyList: $("#historyList"), clearHistoryBtn: $("#clearHistoryBtn"),
  aboutBtn: $("#aboutBtn"), aboutDialog: $("#aboutDialog"), closeDialogBtn: $("#closeDialogBtn"),
  ticks: $("#ticks"),
};

// Gauge ticks (log-ish scale labels already in HTML; ticks are decorative)
(function buildTicks(){
  const cx=160, cy=165, r=135;
  let html="";
  for(let i=0;i<=20;i++){
    const angle = Math.PI - (i/20)*Math.PI; // PI to 0
    const x1 = cx + Math.cos(angle)*(r-8), y1 = cy - Math.sin(angle)*(r-8);
    const x2 = cx + Math.cos(angle)*(r+2), y2 = cy - Math.sin(angle)*(r+2);
    const major = i%5===0;
    html += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${major ? '#9AB8AF' : '#DCE6E2'}" stroke-width="${major?2:1.2}" stroke-linecap="round"/>`;
  }
  els.ticks.innerHTML = html;
})();

const ARC_LEN = 424; // approx length of semicircle r=135: pi*135 ≈ 424
function speedToFraction(mbps){
  // log scale 0..1000+
  if(mbps<=0) return 0;
  const clamped = Math.min(mbps, 1000);
  // log10 scale: 1 Mbps -> ~0.15, 10->0.4, 100->0.66, 1000->1
  return Math.max(0, Math.min(1, Math.log10(clamped+1)/3 ));
}
function setGauge(mbps, label){
  els.gaugeValue.textContent = mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1);
  if(label) els.gaugeLabel.textContent = label;
  const frac = speedToFraction(mbps);
  els.gaugeArc.style.strokeDashoffset = String(ARC_LEN * (1-frac));
  // color shifts with speed
  if(mbps >= 100) els.gaugeArc.style.stroke = "#0F766E";
  else if(mbps >= 25) els.gaugeArc.style.stroke = "#0E9F6E";
  else if(mbps > 0) els.gaugeArc.style.stroke = "#D97706";
  else els.gaugeArc.style.stroke = "#0F766E";
}
function setPhase(text, testing=false){
  els.phaseLabel.textContent = text;
  els.phaseLabel.classList.toggle("testing", testing);
}
function setStep(name, state){ // state: '', 'active', 'done'
  document.querySelectorAll(".step").forEach(el=>{
    if(el.dataset.step===name){
      el.classList.remove("active","done");
      if(state) el.classList.add(state);
    }
  });
}
function setProgress(pct){ els.progressBar.style.width = `${Math.max(0,Math.min(100,pct))}%`; }
function fmt(n, digits=1){ return Number.isFinite(n) ? n.toFixed(digits) : "—"; }
function ratingFor(mbps, type){
  if(!Number.isFinite(mbps)) return {label:"—", cls:""};
  if(type==="ping"){
    if(mbps<=20) return {label:"Excellent", cls:"good"};
    if(mbps<=50) return {label:"Good", cls:"good"};
    if(mbps<=100) return {label:"Okay", cls:"ok"};
    return {label:"High", cls:"slow"};
  }
  if(mbps>=100) return {label:"Fast", cls:"good"};
  if(mbps>=50) return {label:"Good", cls:"good"};
  if(mbps>=25) return {label:"Okay", cls:"ok"};
  if(mbps>=10) return {label:"Slow", cls:"ok"};
  return {label:"Very slow", cls:"slow"};
}
function verdictFor(dl, ul, ping){
  if(!Number.isFinite(dl)) return null;
  const can4k = dl>=25, canCall = dl>=10 && ul>=5, canGame = ping<=50 && dl>=15, canUpload = ul>=20;
  let headline, pill;
  if(dl>=100 && ping<=30) { headline="Excellent — this connection handles everything comfortably, including 4K, big downloads, and competitive gaming."; pill="Excellent"; }
  else if(dl>=50) { headline="Great for everyday use — smooth 4K streaming, clear video calls, and fast downloads."; pill="Great"; }
  else if(dl>=25) { headline="Solid — handles 4K streaming and video calls well. Very large downloads will take a bit longer."; pill="Good"; }
  else if(dl>=10) { headline="Okay for HD streaming and browsing. 4K and large files may buffer or take a while."; pill="Fair"; }
  else { headline="Slow — best for browsing and messaging. Video may buffer, especially if others share the connection."; pill="Slow"; }
  return { headline, pill, rows:[
    ["4K streaming", can4k ? "Yes" : (dl>=15 ? "Maybe 1 stream" : "Unlikely")],
    ["Video calls", canCall ? "Smooth HD" : (dl>=5 ? "Standard quality" : "May struggle")],
    ["Online gaming", canGame ? "Responsive" : (ping<=80 ? "Playable" : "Lag likely")],
    ["Large uploads", canUpload ? "Fast" : (ul>=10 ? "Moderate" : "Slow")],
  ]};
}

// State
let abortController = null;
let isRunning = false;
let lastResult = null;
let totalBytes = 0;
let testStart = 0;

const CF = "https://speed.cloudflare.com";

async function fetchMeta(){
  try{
    const r = await fetch(`${CF}/meta`, { cache:"no-store" });
    if(!r.ok) return null;
    return await r.json();
  }catch{ return null; }
}

// --- Ping ---
async function measurePing(signal){
  const samples = [];
  const N = 12;
  for(let i=0;i<N;i++){
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    const url = `${CF}/__down?bytes=0&r=${Math.random().toString(36).slice(2)}`;
    const t0 = performance.now();
    try{
      const res = await fetch(url, { cache:"no-store", signal });
      // consume tiny body
      await res.arrayBuffer();
    }catch(e){
      if(e.name==="AbortError") throw e;
      // fallback: time the error as well? skip sample
      continue;
    }
    const dt = performance.now()-t0;
    samples.push(dt);
    // small pause
    await new Promise(r=>setTimeout(r, 60));
  }
  if(samples.length===0) throw new Error("Ping failed — check your connection and try again.");
  samples.sort((a,b)=>a-b);
  // drop top 2 outliers if enough samples
  const trimmed = samples.length>6 ? samples.slice(0, samples.length-2) : samples;
  const median = trimmed[Math.floor(trimmed.length/2)];
  const min = trimmed[0];
  const avg = trimmed.reduce((a,b)=>a+b,0)/trimmed.length;
  const jitter = trimmed.length>1
    ? trimmed.slice(1).reduce((acc,v,i)=>acc+Math.abs(v-trimmed[i]),0)/(trimmed.length-1)
    : 0;
  // Use median as displayed ping (more stable than min)
  return { ping: median, min, avg, jitter, samples: trimmed };
}

// --- Download ---
async function measureDownload(signal, onProgress){
  // Adaptive: 4 parallel streams, 10 seconds, sizes grow
  const DURATION_MS = 10000;
  const PARALLEL = 4;
  const start = performance.now();
  let bytes = 0;
  let lastBytes = 0;
  let lastTime = start;
  let currentMbps = 0;

  const sizes = [1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000];
  let sizeIdx = 0;

  async function worker(){
    while(!signal.aborted && performance.now()-start < DURATION_MS){
      const size = sizes[Math.min(sizeIdx, sizes.length-1)];
      // gradually increase requested size
      if(performance.now()-start > 3000) sizeIdx = Math.max(sizeIdx,1);
      if(performance.now()-start > 6000) sizeIdx = Math.max(sizeIdx,2);
      const url = `${CF}/__down?bytes=${size}&r=${Math.random().toString(36).slice(2)}`;
      try{
        const res = await fetch(url, { cache:"no-store", signal });
        if(!res.ok || !res.body) {
          // fallback: arrayBuffer
          const buf = await res.arrayBuffer();
          bytes += buf.byteLength;
          continue;
        }
        const reader = res.body.getReader();
        while(true){
          if(signal.aborted) break;
          if(performance.now()-start >= DURATION_MS) { try{ await reader.cancel(); }catch{} break; }
          const { done, value } = await reader.read();
          if(done) break;
          bytes += value.byteLength;
        }
      }catch(e){
        if(e.name==="AbortError" || signal.aborted) break;
        // brief pause before retry
        await new Promise(r=>setTimeout(r, 120));
      }
    }
  }

  const progressTimer = setInterval(()=>{
    const now = performance.now();
    const elapsed = (now-start)/1000;
    if(elapsed<=0) return;
    const intervalBytes = bytes - lastBytes;
    const intervalTime = (now-lastTime)/1000;
    if(intervalTime>0.25){
      currentMbps = (intervalBytes*8)/(intervalTime*1_000_000);
      lastBytes = bytes; lastTime = now;
    }
    const overallMbps = (bytes*8)/(elapsed*1_000_000);
    // Blend: show instantaneous smoothed
    const display = currentMbps>0 ? (currentMbps*0.6 + overallMbps*0.4) : overallMbps;
    onProgress(display, bytes, elapsed);
  }, 200);

  try{
    await Promise.all(Array.from({length: PARALLEL}, worker));
  } finally {
    clearInterval(progressTimer);
  }
  const elapsed = (performance.now()-start)/1000;
  const mbps = (bytes*8)/(elapsed*1_000_000);
  totalBytes += bytes;
  return { mbps, bytes, elapsed };
}

// --- Upload ---
async function measureUpload(signal, onProgress){
  const DURATION_MS = 10000;
  const PARALLEL = 3;
  const start = performance.now();
  let bytes = 0;
  let lastBytes = 0, lastTime = start, currentMbps = 0;

  // Pre-generate payloads
  function makePayload(size){
    const buf = new Uint8Array(size);
    // fill with random-ish pattern (crypto not needed)
    for(let i=0;i<size;i+=4096){ buf.fill(Math.floor(Math.random()*256), i, Math.min(i+4096,size)); }
    return new Blob([buf], {type:"application/octet-stream"});
  }
  const payloads = [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000].map(makePayload);
  let pIdx = 0;

  async function worker(){
    while(!signal.aborted && performance.now()-start < DURATION_MS){
      const elapsed = performance.now()-start;
      if(elapsed>2500) pIdx = Math.max(pIdx,1);
      if(elapsed>5000) pIdx = Math.max(pIdx,2);
      if(elapsed>7000) pIdx = Math.max(pIdx,3);
      const payload = payloads[Math.min(pIdx, payloads.length-1)];
      try{
        const res = await fetch(`${CF}/__up`, { method:"POST", body: payload, signal, cache:"no-store" });
        // upload completes when response returns; count payload size
        bytes += payload.size;
        // drain response
        try{ await res.arrayBuffer(); }catch{}
      }catch(e){
        if(e.name==="AbortError" || signal.aborted) break;
        await new Promise(r=>setTimeout(r, 120));
      }
    }
  }

  const progressTimer = setInterval(()=>{
    const now = performance.now();
    const elapsed = (now-start)/1000;
    if(elapsed<=0) return;
    const intervalBytes = bytes-lastBytes;
    const intervalTime = (now-lastTime)/1000;
    if(intervalTime>0.25){
      currentMbps = (intervalBytes*8)/(intervalTime*1_000_000);
      lastBytes = bytes; lastTime = now;
    }
    const overallMbps = (bytes*8)/(elapsed*1_000_000);
    const display = currentMbps>0 ? (currentMbps*0.6 + overallMbps*0.4) : overallMbps;
    onProgress(display, bytes, elapsed);
  }, 200);

  try{ await Promise.all(Array.from({length: PARALLEL}, worker)); }
  finally{ clearInterval(progressTimer); }

  const elapsed = (performance.now()-start)/1000;
  const mbps = (bytes*8)/(elapsed*1_000_000);
  totalBytes += bytes;
  return { mbps, bytes, elapsed };
}

// --- History (localStorage) ---
const HISTORY_KEY = "pulse-speed-history-v1";
function loadHistory(){
  try{ return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }catch{ return []; }
}
function saveHistory(entry){
  const list = loadHistory();
  list.unshift(entry);
  const trimmed = list.slice(0,8);
  try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed)); }catch{}
  renderHistory(trimmed);
}
function renderHistory(list = loadHistory()){
  if(!list.length){
    els.historyList.innerHTML = `<p class="empty">No tests yet. Your last 8 results will appear here and stay on this device.</p>`;
    return;
  }
  els.historyList.innerHTML = list.map(h=>{
    const d = new Date(h.time);
    const when = d.toLocaleString(undefined,{month:"short", day:"numeric", hour:"numeric", minute:"2-digit"});
    const score = h.dl>=50 ? "Fast" : h.dl>=25 ? "Good" : h.dl>=10 ? "Fair" : "Slow";
    return `<div class="history-item">
      <div class="h-when">${when}</div>
      <div class="h-vals"><span>↓ ${fmt(h.dl, h.dl>=100?0:1)} Mbps</span> &nbsp; <span>↑ ${fmt(h.ul, h.ul>=100?0:1)} Mbps</span> &nbsp; <span>${fmt(h.ping,0)} ms</span></div>
      <div class="h-score">${score}</div>
    </div>`;
  }).join("");
}
renderHistory();

// --- UI reset / run ---
function resetUI(){
  setGauge(0, "Press Start Test");
  els.dlValue.textContent="—"; els.ulValue.textContent="—"; els.pingValue.textContent="—";
  els.jitterValue.textContent="—";
  els.dlMeter.style.width="0%"; els.ulMeter.style.width="0%";
  els.dlBadge.textContent="—"; els.dlBadge.className="card-badge";
  els.ulBadge.textContent="—"; els.ulBadge.className="card-badge";
  els.dlSub.textContent="Your download speed"; els.ulSub.textContent="Your upload speed";
  els.pingSub.textContent="Latency to edge server";
  els.verdictPill.textContent="Not tested"; els.verdictText.textContent="Run a test to see what your connection is good for — streaming, gaming, calls, and more.";
  els.verdictList.innerHTML = `
    <div class="v-row"><span>4K streaming</span><b>—</b></div>
    <div class="v-row"><span>Video calls</span><b>—</b></div>
    <div class="v-row"><span>Online gaming</span><b>—</b></div>
    <div class="v-row"><span>Large uploads</span><b>—</b></div>`;
  els.copyBtn.disabled = true; els.shareBtn.disabled = true;
  els.copyFeedback.textContent="";
  setProgress(0);
  ["ping","download","upload","done"].forEach(s=>setStep(s,""));
}

async function runTest(){
  if(isRunning) return;
  isRunning = true;
  totalBytes = 0;
  testStart = performance.now();
  abortController = new AbortController();
  const signal = abortController.signal;

  resetUI();
  els.startBtn.disabled = true;
  els.startBtnText.textContent = "Testing…";
  els.cancelBtn.classList.remove("hidden");
  els.serverPill.innerHTML = `<span class="dot dot-live"></span> Testing — Cloudflare Edge`;
  setPhase("Testing", true);

  // Meta (best-effort, doesn't block ping)
  fetchMeta().then(meta=>{
    if(meta){
      const coloObj = (meta.colo && typeof meta.colo === "object") ? meta.colo : null;
      const colo = coloObj ? (coloObj.iata || coloObj.city || "") : (meta.colo || "");
      const coloCity = coloObj ? (coloObj.city || meta.city || "") : (meta.city || "");
      const coloLabel = colo ? (coloCity && coloCity !== colo ? `${colo} — ${coloCity}` : colo) : coloCity;
      const clientIp = meta.clientIp || "";
      if(coloLabel){ els.serverValue.textContent = coloLabel; els.dServer.textContent = `Cloudflare — ${coloLabel} (closest edge)`; }
      if(clientIp) els.dIp.textContent = clientIp;
    }
  }).catch(()=>{});

  try{
    // PING
    setStep("ping","active"); setGauge(0,"Measuring ping…"); els.liveHint.textContent="Measuring latency — sending tiny pings to the edge…"; setProgress(5);
    const pingRes = await measurePing(signal);
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    els.pingValue.textContent = fmt(pingRes.ping,0);
    els.jitterValue.textContent = `${fmt(pingRes.jitter,1)} ms`;
    els.pingSub.textContent = pingRes.ping<=30 ? "Very responsive" : pingRes.ping<=60 ? "Responsive" : pingRes.ping<=100 ? "Noticeable delay" : "High latency";
    setStep("ping","done"); setProgress(18);

    // DOWNLOAD
    setStep("download","active"); els.liveHint.textContent="Measuring download — opening parallel streams…"; setGauge(0,"Downloading…");
    const dlRes = await measureDownload(signal, (mbps)=>{
      setGauge(mbps, "Downloading…");
      els.dlValue.textContent = fmt(mbps, mbps>=100?0:1);
      // progress 18 -> 58
      // approximate by time: we don't know exact elapsed here, use gauge phase via progress bar width from bytes? keep time-based in interval below
    });
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    // animate progress to 58
    setProgress(58);
    els.dlValue.textContent = fmt(dlRes.mbps, dlRes.mbps>=100?0:1);
    els.dlMeter.style.width = `${Math.min(100, speedToFraction(dlRes.mbps)*100)}%`;
    const dlR = ratingFor(dlRes.mbps,"dl");
    els.dlBadge.textContent = dlR.label; els.dlBadge.className = `card-badge ${dlR.cls}`;
    els.dlSub.textContent = dlRes.mbps>=50 ? "Great for 4K & large downloads" : dlRes.mbps>=25 ? "Good for streaming & calls" : dlRes.mbps>=10 ? "Okay for HD streaming" : "May buffer on video";
    setGauge(dlRes.mbps, "Download complete");
    setStep("download","done");

    // small pause so user sees download result
    await new Promise(r=>setTimeout(r, 450));
    if(signal.aborted) throw new DOMException("Aborted","AbortError");

    // UPLOAD
    setStep("upload","active"); els.liveHint.textContent="Measuring upload — sending data to the edge…"; setGauge(0,"Uploading…"); setProgress(62);
    const ulRes = await measureUpload(signal, (mbps)=>{
      setGauge(mbps, "Uploading…");
      els.ulValue.textContent = fmt(mbps, mbps>=100?0:1);
    });
    if(signal.aborted) throw new DOMException("Aborted","AbortError");
    setProgress(92);
    els.ulValue.textContent = fmt(ulRes.mbps, ulRes.mbps>=100?0:1);
    els.ulMeter.style.width = `${Math.min(100, speedToFraction(ulRes.mbps)*100)}%`;
    const ulR = ratingFor(ulRes.mbps,"ul");
    els.ulBadge.textContent = ulR.label; els.ulBadge.className = `card-badge ${ulR.cls}`;
    els.ulSub.textContent = ulRes.mbps>=20 ? "Fast for calls & cloud uploads" : ulRes.mbps>=10 ? "Good for video calls" : ulRes.mbps>=5 ? "Okay for calls" : "Slow for large uploads";
    setGauge(ulRes.mbps, "Upload complete");
    setStep("upload","done");

    // DONE
    setStep("done","done"); setProgress(100);
    const durationSec = (performance.now()-testStart)/1000;
    const verdict = verdictFor(dlRes.mbps, ulRes.mbps, pingRes.ping);
    if(verdict){
      els.verdictPill.textContent = verdict.pill;
      els.verdictText.textContent = verdict.headline;
      els.verdictList.innerHTML = verdict.rows.map(([k,v])=>`<div class="v-row"><span>${k}</span><b>${v}</b></div>`).join("");
    }
    // Show final gauge as download (primary metric)
    setGauge(dlRes.mbps, `Download ${fmt(dlRes.mbps, dlRes.mbps>=100?0:1)} Mbps • Upload ${fmt(ulRes.mbps, ulRes.mbps>=100?0:1)} Mbps`);
    setPhase("Complete", false);
    els.liveHint.textContent = "Test complete. Run again to confirm — speeds vary with Wi-Fi and network load.";

    els.dDuration.textContent = `${durationSec.toFixed(1)}s`;
    els.dData.textContent = totalBytes>=1_000_000_000 ? `${(totalBytes/1_000_000_000).toFixed(2)} GB` : `${(totalBytes/1_000_000).toFixed(1)} MB`;
    els.dTime.textContent = new Date().toLocaleString();

    lastResult = { dl: dlRes.mbps, ul: ulRes.mbps, ping: pingRes.ping, jitter: pingRes.jitter, time: Date.now(), duration: durationSec, dataMB: totalBytes/1_000_000 };
    els.copyBtn.disabled = false; els.shareBtn.disabled = false;
    saveHistory(lastResult);

  }catch(e){
    if(e.name==="AbortError"){
      setPhase("Cancelled", false);
      els.liveHint.textContent="Test cancelled. Press Start Test to try again.";
      setGauge(0,"Cancelled");
    }else{
      console.error(e);
      setPhase("Error", false);
      els.liveHint.textContent = e.message || "Something went wrong. Check your connection and try again.";
      els.gaugeLabel.textContent = "Test failed — try again";
    }
    setProgress(0);
    ["ping","download","upload","done"].forEach(s=>{
      const el=document.querySelector(`[data-step="${s}"]`);
      if(el && !el.classList.contains("done")) el.classList.remove("active");
    });
  }finally{
    isRunning = false;
    els.startBtn.disabled = false;
    els.startBtnText.textContent = lastResult ? "Test Again" : "Start Test";
    els.cancelBtn.classList.add("hidden");
    els.serverPill.innerHTML = `<span class="dot dot-idle"></span> Cloudflare Edge`;
    abortController = null;
  }
}

// Download/upload progress bar time-based updater while running
setInterval(()=>{
  if(!isRunning) return;
  // gentle progress creep based on elapsed phases is handled explicitly; this keeps bar alive during download/upload
  // (explicit setProgress calls above set milestones; interval avoids stuck look)
}, 500);

els.startBtn.addEventListener("click", runTest);
els.cancelBtn.addEventListener("click", ()=>{ if(abortController) abortController.abort(); });

els.copyBtn.addEventListener("click", async ()=>{
  if(!lastResult) return;
  const text = `Pulse Speed Test — Download ${fmt(lastResult.dl,1)} Mbps • Upload ${fmt(lastResult.ul,1)} Mbps • Ping ${fmt(lastResult.ping,0)} ms (jitter ${fmt(lastResult.jitter,1)} ms) — ${new Date(lastResult.time).toLocaleString()}`;
  try{ await navigator.clipboard.writeText(text); els.copyFeedback.textContent="Copied to clipboard."; }
  catch{ els.copyFeedback.textContent=text; }
  setTimeout(()=> els.copyFeedback.textContent="", 3000);
});
els.shareBtn.addEventListener("click", async ()=>{
  if(!lastResult) return;
  const text = `My internet speed: ↓ ${fmt(lastResult.dl,1)} Mbps ↑ ${fmt(lastResult.ul,1)} Mbps • Ping ${fmt(lastResult.ping,0)} ms`;
  if(navigator.share){
    try{ await navigator.share({ title:"Pulse Speed Test", text }); }catch{}
  }else{
    try{ await navigator.clipboard.writeText(text); els.copyFeedback.textContent="Share text copied — paste it anywhere."; }catch{ els.copyFeedback.textContent=text; }
    setTimeout(()=> els.copyFeedback.textContent="", 3000);
  }
});
els.clearHistoryBtn.addEventListener("click", ()=>{
  try{ localStorage.removeItem(HISTORY_KEY); }catch{}
  renderHistory([]);
});
els.aboutBtn.addEventListener("click", ()=> els.aboutDialog.showModal());
els.closeDialogBtn.addEventListener("click", ()=> els.aboutDialog.close());
els.aboutDialog.addEventListener("click", (e)=>{ if(e.target===els.aboutDialog) els.aboutDialog.close(); });

// Keyboard: Space/Enter on Start when not typing
document.addEventListener("keydown", (e)=>{
  if(e.code==="Space" && document.activeElement===document.body){ e.preventDefault(); if(!isRunning) runTest(); }
});

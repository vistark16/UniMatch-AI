// ===== Unimatch AI - Frontend (University + Major Selection + Chatbot) =====
const API_BASE = window.API_BASE || "http://127.0.0.1:8000";

const GRADE_FIELDS = [
  "s1","s2","s3","s4","s5",
  "math","language","physics","chemistry","biology",
  "economics","geography","history"
];
const NUMERIC_FIELDS = [...GRADE_FIELDS, "rank_percentile"];

function $(id){ return document.getElementById(id); }
function clamp(n,min,max){ if(Number.isNaN(n)) return undefined; return Math.max(min, Math.min(max, n)); }

function val(id){
  const el = $(id); if(!el) return undefined;
  const raw = el.value?.trim(); if(raw === "") return undefined;
  if(!isNaN(Number(raw)) && NUMERIC_FIELDS.includes(id)){
    let n = Number(raw);
    if(GRADE_FIELDS.includes(id)) n = clamp(n,0,100);
    if(id === "rank_percentile") n = clamp(Math.round(n),1,100);
    return n;
  }
  return raw;
}

function atLeastOneGradeFilled(){
  return GRADE_FIELDS.slice(0,5).some(k => typeof val(k) === "number");
}

/* ====== Data Storage ====== */
const UNIVERSITIES_DATA = { all: [] };
const MAJORS_DATA = { all: [] };

/* ====== View Management ====== */
let currentView = 'prediction'; // 'prediction' or 'chatbot'

function switchView(view) {
  const predictionView = $('predictionView');
  const chatbotView = $('chatbotView');
  const toggleBtn = $('toggleView');
  
  if (view === 'chatbot') {
    predictionView.style.display = 'none';
    chatbotView.style.display = 'block';
    toggleBtn.textContent = 'SNBP Prediction';
    currentView = 'chatbot';
  } else {
    predictionView.style.display = 'block';
    chatbotView.style.display = 'none';
    toggleBtn.textContent = 'Konsultasi Chatbot';
    currentView = 'prediction';
  }
}

/* ====== University + Major Selection System ====== */
const SELECTION_PAIRS = {
  choice1: { 
    university: { selected: null, input: null, dropdown: null, selectedDiv: null, box: null },
    major: { selected: null, input: null, dropdown: null, selectedDiv: null, box: null, disabled: true }
  },
  choice2: { 
    university: { selected: null, input: null, dropdown: null, selectedDiv: null, box: null },
    major: { selected: null, input: null, dropdown: null, selectedDiv: null, box: null, disabled: true }
  },
  choice3: { 
    university: { selected: null, input: null, dropdown: null, selectedDiv: null, box: null },
    major: { selected: null, input: null, dropdown: null, selectedDiv: null, box: null, disabled: true }
  }
};

function programOfMajor(university, name) {
  if (!university || !name) return "unknown";
  
  const key = `${university} | ${name}`;
  const details = MAJORS_DATA.details[key];
  
  // Jika ada data detail, gunakan program dari sana
  if (details && details.program) {
    return details.program.toLowerCase();
  }
  
  // Fallback ke deteksi berdasarkan nama major
  const s = (name || "").toLowerCase();
  const saintek = ["fisika","kimia","biologi","kedokteran","informatika","statistika","elektro","mesin","teknik","matematika","farmasi","geologi","perikanan","arsitektur","kehutanan","pertanian","perkapalan"];
  const soshum  = ["hukum","ekonomi","manajemen","akuntansi","psikologi","sosiologi","sejarah","ilmu","komunikasi","bahasa","pendidikan","administrasi","hubungan","politik","pariwisata","bisnis"];
  
  if (saintek.some(k => s.includes(k))) return "saintek";
  if (soshum.some(k => s.includes(k))) return "soshum";
  return "unknown";
}

function loadUniversitiesOptions(){
  return fetch(`${API_BASE}/api/kb/universities`)
    .then(r=>r.json())
    .then(d=>{
      UNIVERSITIES_DATA.all = Array.isArray(d.universities) ? d.universities : [];
    })
    .catch(()=>{ UNIVERSITIES_DATA.all = []; });
}

function loadMajorsOptions() {
  return fetch(`${API_BASE}/api/kb/majors-full`)
    .then(r => r.json())
    .then(d => {
      MAJORS_DATA.all = Array.isArray(d.majors) ? d.majors : [];
      MAJORS_DATA.details = d.details || {};
    })
    .catch(() => { 
      MAJORS_DATA.all = [];
      MAJORS_DATA.details = {};
    });
}

function getMajorsForUniversity(universityName) {
   if (!universityName) return [];
  
  return MAJORS_DATA.all.filter(m => {
    const uniMajorKey = `${universityName} | ${m}`;
    return MAJORS_DATA.details[uniMajorKey] !== undefined;
  });
}

function getSelectedUniversities() {
  const selected = [];
  Object.keys(SELECTION_PAIRS).forEach(key => {
    if (SELECTION_PAIRS[key].university.selected) {
      selected.push(SELECTION_PAIRS[key].university.selected);
    }
  });
  return selected;
}

function getSelectedMajors() {
  const selected = [];
  Object.keys(SELECTION_PAIRS).forEach(key => {
    if (SELECTION_PAIRS[key].major.selected) {
      selected.push(SELECTION_PAIRS[key].major.selected);
    }
  });
  return selected;
}

function getAvailableUniversities(currentKey) {
  const alreadySelected = new Set();
  
  Object.keys(SELECTION_PAIRS).forEach(key => {
    if (key !== currentKey && SELECTION_PAIRS[key].university.selected) {
      alreadySelected.add(SELECTION_PAIRS[key].university.selected);
    }
  });

  return UNIVERSITIES_DATA.all.filter(u => !alreadySelected.has(u));
}

function getAvailableMajorsForChoice(choiceKey) {
  const universitySelected = SELECTION_PAIRS[choiceKey].university.selected;
  if (!universitySelected) return [];
  
  const alreadySelectedMajors = new Set();
  
  Object.keys(SELECTION_PAIRS).forEach(key => {
    if (key !== choiceKey && SELECTION_PAIRS[key].major.selected) {
      alreadySelectedMajors.add(SELECTION_PAIRS[key].major.selected);
    }
  });

  return getMajorsForUniversity(universitySelected)
    .filter(m => !alreadySelectedMajors.has(m));
}

function renderSelectedItem(choiceKey, type) {
  const selector = SELECTION_PAIRS[choiceKey][type];
  const selectedDiv = selector.selectedDiv;
  
  if (selector.selected) {
    selectedDiv.innerHTML = `
      <div class="selected-chip">
        ${selector.selected}
        <button class="remove-btn" data-choice="${choiceKey}" data-type="${type}">×</button>
      </div>
    `;
    selector.input.style.display = 'none';
    
    selectedDiv.querySelector('.remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearSelection(choiceKey, type);
    });
  } else {
    selectedDiv.innerHTML = '';
    selector.input.style.display = 'block';
  }
}

function clearSelection(choiceKey, type) {
  SELECTION_PAIRS[choiceKey][type].selected = null;
  SELECTION_PAIRS[choiceKey][type].input.value = '';
  SELECTION_PAIRS[choiceKey][type].dropdown.hidden = true;
  renderSelectedItem(choiceKey, type);
  
  if (type === 'university') {
    clearSelection(choiceKey, 'major');
    setMajorDisabled(choiceKey, true);
  }
}

function selectItem(choiceKey, type, item) {
  SELECTION_PAIRS[choiceKey][type].selected = item;
  SELECTION_PAIRS[choiceKey][type].input.value = '';
  SELECTION_PAIRS[choiceKey][type].dropdown.hidden = true;
  renderSelectedItem(choiceKey, type);
  
  if (type === 'university') {
    clearSelection(choiceKey, 'major');
    setMajorDisabled(choiceKey, false);
  }
}

function setMajorDisabled(choiceKey, disabled) {
  const majorSelector = SELECTION_PAIRS[choiceKey].major;
  majorSelector.disabled = disabled;
  majorSelector.box.classList.toggle('disabled', disabled);
  majorSelector.input.disabled = disabled;
  if (disabled) {
    majorSelector.input.placeholder = 'Select university first';
  } else {
    majorSelector.input.placeholder = 'Type to search major';
  }
}

function showAllOptions(choiceKey, type) {
  const selector = SELECTION_PAIRS[choiceKey][type];
  let available = [];
  
  if (type === 'university') {
    available = getAvailableUniversities(choiceKey);
  } else if (type === 'major') {
    if (selector.disabled) return;
    available = getAvailableMajorsForChoice(choiceKey);
  }

  if (!available.length) {
    const message = type === 'university' ? 'No universities available.' : 'No majors available.';
    selector.dropdown.innerHTML = `<div class="empty">${message}</div>`;
    selector.dropdown.hidden = false;
    return;
  }

  selector.dropdown.innerHTML = available.slice(0, 12).map(item => 
    `<div class="opt" data-choice="${choiceKey}" data-type="${type}" data-item="${encodeURIComponent(item)}">${item}</div>`
  ).join("");
  
  selector.dropdown.style.zIndex = '9999';
  selector.dropdown.hidden = false;

  selector.dropdown.querySelectorAll(".opt").forEach(opt => {
    opt.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const item = decodeURIComponent(opt.dataset.item);
      const targetChoice = opt.dataset.choice;
      const targetType = opt.dataset.type;
      selectItem(targetChoice, targetType, item);
    });
  });
}

function renderSearchResults(choiceKey, type, query) {
  const selector = SELECTION_PAIRS[choiceKey][type];
  
  if (!query) {
    selector.dropdown.hidden = true;
    return;
  }
  
  let available = [];
  if (type === 'university') {
    available = getAvailableUniversities(choiceKey);
  } else if (type === 'major') {
    if (selector.disabled) return;
    available = getAvailableMajorsForChoice(choiceKey);
  }
  
  const filtered = available.filter(item => 
    item.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 12);

  if (!filtered.length) {
    selector.dropdown.innerHTML = `<div class="empty">No matches for "${query}".</div>`;
    selector.dropdown.style.zIndex = '9999';
    selector.dropdown.hidden = false;
    return;
  }
  
  selector.dropdown.innerHTML = filtered.map(item => 
    `<div class="opt" data-choice="${choiceKey}" data-type="${type}" data-item="${encodeURIComponent(item)}">${item}</div>`
  ).join("");
  
  selector.dropdown.style.zIndex = '9999';
  selector.dropdown.hidden = false;

  selector.dropdown.querySelectorAll(".opt").forEach(opt => {
    opt.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const item = decodeURIComponent(opt.dataset.item);
      const targetChoice = opt.dataset.choice;
      const targetType = opt.dataset.type;
      selectItem(targetChoice, targetType, item);
    });
  });
}

function initSingleSelector(choiceKey, type) {
  const selector = SELECTION_PAIRS[choiceKey][type];
  selector.box = $(`${choiceKey}${type.charAt(0).toUpperCase() + type.slice(1)}Box`);
  selector.input = $(`${choiceKey}${type.charAt(0).toUpperCase() + type.slice(1)}Input`);
  selector.dropdown = $(`${choiceKey}${type.charAt(0).toUpperCase() + type.slice(1)}Dropdown`);
  selector.selectedDiv = $(`${choiceKey}${type.charAt(0).toUpperCase() + type.slice(1)}Selected`);

  if (type === 'major') {
    setMajorDisabled(choiceKey, true);
  }

  selector.input.addEventListener("input", () => {
    renderSearchResults(choiceKey, type, selector.input.value.trim());
  });
  
  selector.input.addEventListener("focus", () => {
    if (type === 'major' && selector.disabled) return;
    const query = selector.input.value.trim();
    if (query) {
      renderSearchResults(choiceKey, type, query);
    }
  });
  
  selector.input.addEventListener("keydown", (e) => {
    if (type === 'major' && selector.disabled) return;
    if (e.key === "Enter") {
      e.preventDefault();
      const first = selector.dropdown.querySelector(".opt");
      if (first) first.dispatchEvent(new MouseEvent("mousedown"));
    } else if (e.key === "Escape") {
      selector.dropdown.hidden = true;
    }
  });
  
  selector.box.addEventListener("click", (e) => {
    if (e.target.matches('.remove-btn')) return;
    if (type === 'major' && selector.disabled) return;
    
    if (selector.selected) {
      selector.input.style.display = 'block';
      selector.input.focus();
      showAllOptions(choiceKey, type);
    } else {
      selector.input.focus();
      showAllOptions(choiceKey, type);
    }
  });
  
  selector.input.addEventListener("blur", () => {
    setTimeout(() => selector.dropdown.hidden = true, 200);
  });

  selector.input.addEventListener("change", () => {
    const query = selector.input.value.trim();
    if (query) {
      renderSearchResults(choiceKey, 'university', query);
    }
  
    if (selector.selected) {
      setMajorDisabled(choiceKey, false);
      showAllOptions(choiceKey, 'major');
    }
  });
}

function initSelectors() {
  Object.keys(SELECTION_PAIRS).forEach(choiceKey => {
    initSingleSelector(choiceKey, 'university');
    initSingleSelector(choiceKey, 'major');
  });
  
  $("program").addEventListener("change", () => {
    Object.keys(SELECTION_PAIRS).forEach(choiceKey => {
      ['university', 'major'].forEach(type => {
        const selector = SELECTION_PAIRS[choiceKey][type];
        if (!selector.dropdown.hidden) {
          if (selector.input.value.trim()) {
            renderSearchResults(choiceKey, type, selector.input.value.trim());
          } else {
            showAllOptions(choiceKey, type);
          }
        }
      });
    });
  });

  Promise.all([loadUniversitiesOptions(), loadMajorsOptions()]);
}

/* ====== Chatbot Functionality ====== */
let chatbotHistory = [];

function addMessageToChat(message, isUser = false) {
  const chatMessages = $('chatMessages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isUser ? 'user-message' : 'bot-message'}`;
  
  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  
  if (isUser) {
    messageContent.textContent = message;
  } else {
    // For bot messages, preserve HTML formatting
    messageContent.innerHTML = message.replace(/\n/g, '<br>');
  }
  
  messageDiv.appendChild(messageContent);
  chatMessages.appendChild(messageDiv);
  
  // Auto scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  // Add to history
  chatbotHistory.push({ message, isUser, timestamp: new Date() });
}

function setTypingIndicator(show) {
  const existingIndicator = $('typingIndicator');
  
  if (show && !existingIndicator) {
    const chatMessages = $('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typingIndicator';
    typingDiv.className = 'message bot-message typing';
    typingDiv.innerHTML = `
      <div class="message-content">
        <div class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (!show && existingIndicator) {
    existingIndicator.remove();
  }
}

async function sendChatMessage(message) {
  if (!message.trim()) return;
  
  // Add user message
  addMessageToChat(message, true);
  
  // Clear input
  $('chatInput').value = '';
  
  // Show typing indicator
  setTypingIndicator(true);
  
  try {
    const response = await fetch(`${API_BASE}/api/chatbot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message })
    });
    
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Remove typing indicator
    setTypingIndicator(false);
    
    // Add bot response
    addMessageToChat(data.response);
    
    // Show recommendations or study plan if available
    if (data.recommendations && data.recommendations.length > 0) {
      showRecommendationsCard(data.recommendations);
    }
    
    if (data.study_plan && data.study_plan.length > 0) {
      showStudyPlanCard(data.study_plan);
    }
    
  } catch (error) {
    console.error('Chatbot error:', error);
    setTypingIndicator(false);
    addMessageToChat('Maaf, terjadi kesalahan. Silakan coba lagi nanti. 😔');
  }
}

function showRecommendationsCard(recommendations) {
  const chatMessages = $('chatMessages');
  const recCard = document.createElement('div');
  recCard.className = 'message bot-message recommendation-card';
  
  let html = `
    <div class="message-content">
      <h4>📊 Rekomendasi Jurusan Detail:</h4>
      <div class="recommendations-table">
  `;
  
  recommendations.slice(0, 8).forEach((rec, index) => {
    const categoryColor = rec.category === 'Sangat Memungkinkan' ? '#22c55e' : 
                         rec.category === 'Memungkinkan' ? '#3b82f6' :
                         rec.category === 'Cukup Memungkinkan' ? '#f59e0b' : '#ef4444';
    
    html += `
      <div class="rec-item">
        <div class="rec-header">
          <span class="rec-rank">#${index + 1}</span>
          <span class="rec-major">${rec.major}</span>
          <span class="rec-probability" style="background: ${categoryColor}">${(rec.probability * 100).toFixed(1)}%</span>
        </div>
        <div class="rec-details">
          <small>🏛️ ${rec.university}</small>
          <small>📈 ${rec.category}</small>
          ${rec.current_gap !== undefined ? `<small>📍 Gap: ${rec.current_gap > 0 ? '+' : ''}${rec.current_gap}</small>` : ''}
        </div>
      </div>
    `;
  });
  
  html += `
      </div>
    </div>
  `;
  
  recCard.innerHTML = html;
  chatMessages.appendChild(recCard);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showStudyPlanCard(studyPlan) {
  const chatMessages = $('chatMessages');
  const planCard = document.createElement('div');
  planCard.className = 'message bot-message study-plan-card';
  
  let html = `
    <div class="message-content">
      <h4>📚 Rencana Belajar:</h4>
      <div class="study-plan-content">
  `;
  
  studyPlan.forEach((subject, index) => {
    const difficultyIcon = subject.difficulty === 'advanced' ? '🔥' : 
                          subject.difficulty === 'intermediate' ? '📋' : '📝';
    
    html += `
      <div class="study-subject">
        <h5>${difficultyIcon} ${subject.subject.replace('_', ' ').toUpperCase()}</h5>
        <ul class="topics-list">
    `;
    
    subject.topics.slice(0, 4).forEach(topic => {
      html += `<li>${topic}</li>`;
    });
    
    if (subject.topics.length > 4) {
      html += `<li><em>+${subject.topics.length - 4} topik lainnya</em></li>`;
    }
    
    html += `
        </ul>
      </div>
    `;
  });
  
  html += `
      </div>
    </div>
  `;
  
  planCard.innerHTML = html;
  chatMessages.appendChild(planCard);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function initChatbot() {
  const chatInput = $('chatInput');
  const sendBtn = $('sendBtn');
  
  // Send message on button click
  sendBtn.addEventListener('click', () => {
    const message = chatInput.value.trim();
    if (message) {
      sendChatMessage(message);
    }
  });
  
  // Send message on Enter key
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const message = chatInput.value.trim();
      if (message) {
        sendChatMessage(message);
      }
    }
  });
  
  // Suggestion buttons (if any exist)
  const suggestionBtns = document.querySelectorAll('.suggestion-btn');
  if (suggestionBtns.length > 0) {
    suggestionBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const suggestionText = btn.dataset.text;
        if (suggestionText) {
          $('chatInput').value = suggestionText;
          sendChatMessage(suggestionText);
        }
      });
    });
  }
  
  // Auto-resize input
  chatInput.addEventListener('input', () => {
    // Reset height to calculate new height
    chatInput.style.height = 'auto';
    
    // Calculate new height based on content
    const newHeight = Math.min(chatInput.scrollHeight, 160); // max 160px
    chatInput.style.height = newHeight + 'px';
    
    // Ensure minimum height
    if (newHeight < 56) {
      chatInput.style.height = '56px';
    }
  });
  
  // Handle paste events
  chatInput.addEventListener('paste', () => {
    setTimeout(() => {
      chatInput.style.height = 'auto';
      const newHeight = Math.min(chatInput.scrollHeight, 160);
      chatInput.style.height = Math.max(newHeight, 56) + 'px';
    }, 0);
  });
}

/* ====== Payload & Rendering ====== */
function collectPayload(){
  const selectedUniversities = getSelectedUniversities();
  const selectedMajors = getSelectedMajors();
  
  return {
    program: val("program"),
    target_university: selectedUniversities[0] || "Unknown",
    target_universities: selectedUniversities,
    target_university_1: SELECTION_PAIRS.choice1.university.selected || null,
    target_university_2: SELECTION_PAIRS.choice2.university.selected || null,
    target_university_3: SELECTION_PAIRS.choice3.university.selected || null,
    target_major: selectedMajors[0] || "Unknown",
    target_majors: selectedMajors,
    target_major_1: SELECTION_PAIRS.choice1.major.selected || null,
    target_major_2: SELECTION_PAIRS.choice2.major.selected || null,
    target_major_3: SELECTION_PAIRS.choice3.major.selected || null,
    competitiveness: val("competitiveness"),
    s1: val("s1"), s2: val("s2"), s3: val("s3"), s4: val("s4"), s5: val("s5"),
    math: val("math"), language: val("language"),
    physics: val("physics"), chemistry: val("chemistry"), biology: val("biology"),
    economics: val("economics"), geography: val("geography"), history: val("history"),
    rank_percentile: val("rank_percentile") ?? 100,
    achievement: val("achievement"),
    accreditation: val("accreditation"),
  };
}

function renderResult(data){
  const el = $("result");
  if(data.error){ 
    el.className="error"; 
    el.innerHTML = Array.isArray(data.error) 
      ? `<strong>Please check:</strong><ul>${data.error.map(e => `<li>${e}</li>`).join('')}</ul>`
      : `Error: ${data.error}`; 
    return; 
  }
  const p = (data.probability*100).toFixed(1)+"%";
  const tips = (data.tips||[]).map(t=>`<li>${t}</li>`).join("");
  el.className="result";
  el.innerHTML = `
    <div class="prob">
      <div class="bar"><div class="fill ${data.label}" style="width:${(data.probability*100).toFixed(0)}%"></div></div>
      <div class="meta"><strong>Probability:</strong> ${p} &nbsp; <strong>Label:</strong> ${data.label.toUpperCase()}</div>
    </div>
    <details><summary>Details</summary><pre>${JSON.stringify(data.details,null,2)}</pre></details>
    ${tips ? `<h3>Recommendations</h3><ul>${tips}</ul>` : ""}
  `;
}

function tableHtml(title, list){
  if(!list || !list.length) return "";
  const rows = list.map((it, i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${it.university||"-"}</td>
      <td>
        ${it.major||"-"}
        ${(it.tags && it.tags.length) ? `<div class="tags">${
          it.tags.slice(0,3).map(t=>`<span class="tag">${t}</span>`).join("")
        }</div>` : ""}
      </td>
      <td>${(it.probability*100).toFixed(1)}%</td>
      <td>${(it.competitiveness||"-").toUpperCase()}</td>
      <td><span class="badge ${it.bucket||'target'}">${(it.bucket||'target').toUpperCase()}</span></td>
    </tr>
  `).join("");
  return `
    <h3 class="section-heading" style="margin-top:18px">${title}</h3>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr><th>#</th><th>University</th><th>Major</th><th>Prob.</th><th>Comp.</th><th>Band</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderRecommendations(blocks){
  const el = $("result");
  if(!blocks) return;
  const { preferred=[], alternatives=[] } = blocks;
  el.insertAdjacentHTML("beforeend",
    tableHtml("Universities for Your Chosen Majors", preferred) +
    tableHtml("You Might Also Consider", alternatives)
  );
}

function setLoading(v){
  const b=$("predictBtn"); if(!b) return;
  b.disabled=v;
  if(v){ 
    b.dataset._t=b.textContent; 
    b.innerHTML=`<span class="btn-dot"></span> Predicting…`; 
  } else { 
    b.textContent=b.dataset._t||"Predict"; 
  }
}

/* ====== Enhanced Validation ====== */
function validateForm() {
  const issues = [];
  
  if (!atLeastOneGradeFilled()) {
    issues.push("Please fill at least one of S1—S5 grades");
  }
  
  const selectedUniversities = getSelectedUniversities();
  const selectedMajors = getSelectedMajors();
  
  if (selectedUniversities.length === 0) {
    issues.push("Please select at least one target university");
  }
  
  if (selectedMajors.length === 0) {
    issues.push("Please select at least one target major");
  }
  
  Object.keys(SELECTION_PAIRS).forEach((key, index) => {
    const univSelected = SELECTION_PAIRS[key].university.selected;
    const majorSelected = SELECTION_PAIRS[key].major.selected;
    
    if (univSelected && !majorSelected) {
      issues.push(`Please select a major for Choice ${index + 1} (${univSelected})`);
    }
  });
  
  const program = val("program");
  
  if (program === "saintek" && selectedMajors.length > 0) {
    if (!val("math")) {
      issues.push("Math grade is highly recommended for Saintek program");
    }
    if (!val("physics") && !val("chemistry") && !val("biology")) {
      issues.push("At least one science subject (Physics/Chemistry/Biology) is recommended");
    }
  }
  
  if (program === "soshum" && selectedMajors.length > 0) {
    if (!val("language")) {
      issues.push("Language grade is highly recommended for Soshum program");
    }
  }
  
  return issues;
}

/* ====== Events ====== */
$("predictBtn").addEventListener("click", async ()=>{
  const el=$("result");
  
  const issues = validateForm();
  if (issues.length > 0) {
    renderResult({ error: issues });
    return;
  }
  
  const payload = collectPayload();
  setLoading(true);
  try{
    const res = await fetch(`${API_BASE}/api/predict`, {
      method:"POST", 
      headers:{"Content-Type":"application/json"}, 
      body:JSON.stringify(payload)
    });
    
    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }
    
    const data = await res.json();
    renderResult(data);

    const recRes = await fetch(`${API_BASE}/api/recommend?pref_n=8&alt_n=8&per_uni=2`, {
      method:"POST", 
      headers:{"Content-Type":"application/json"}, 
      body:JSON.stringify(payload)
    });
    
    if (recRes.ok) {
      const rec = await recRes.json();
      if(rec.preferred || rec.alternatives) renderRecommendations(rec);
    }
  }catch(err){
    console.error('Prediction error:', err);
    renderResult({
      error: err.message || 'Unable to connect to server. Please try again.'
    });
  }finally{ 
    setLoading(false); 
  }
});

$("resetBtn").addEventListener("click", ()=>{
  document.querySelectorAll("input,select").forEach(el=>{ el.value=""; });
  $("program").value="saintek"; 
  $("competitiveness").value="high"; 
  $("achievement").value="none"; 
  $("accreditation").value="B";
  $("rank_percentile").value="100";
  
  Object.keys(SELECTION_PAIRS).forEach(choiceKey => {
    clearSelection(choiceKey, 'university');
    clearSelection(choiceKey, 'major');
    setMajorDisabled(choiceKey, true);
  });
  
  const res=$("result"); 
  res.className="muted"; 
  res.textContent="Fill the form and click Predict.";
});

// View Toggle Event
$("toggleView").addEventListener("click", () => {
  switchView(currentView === 'prediction' ? 'chatbot' : 'prediction');
});

/* ===== Theme toggle ===== */
(function () {
  const KEY="unimatch_theme", root=document.documentElement;
  function apply(t){ root.setAttribute("data-theme", t); }
  let saved=localStorage.getItem(KEY);
  if(!saved) saved = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark":"light";
  apply(saved);
  const btn=$("themeToggle");
  if(btn){ 
    btn.addEventListener("click", ()=>{ 
      const next=root.getAttribute("data-theme")==="dark"?"light":"dark"; 
      apply(next); 
      localStorage.setItem(KEY,next); 
    }); 
  }
})();

/* ===== Init ===== */
document.addEventListener("DOMContentLoaded", ()=>{ 
  initSelectors();
  initChatbot();
});
// マスタデータの初期値（GASから取得するまでのフォールバック）
const MASTER_DATA = {
    locations: ["北ビニールハウス", "南ビニールハウス", "畑(旧上)", "畑(旧下)", "畑(中間)", "畑(北の北)", "田んぼ"],
    works: {
        "共通": ["トラクター", "土作り", "肥料散布", "播種", "水やり", "定植", "作物管理", "収穫", "出荷準備", "出荷", "配送"],
        "ビニールハウス": ["ベット作り", "マルチ張り", "マルチ穴あけ", "誘引", "芽かき", "受粉", "摘果", "袋・箱詰め"],
        "田んぼ": ["代掻き", "田植え", "除草", "溝切り", "草刈り"]
    }
};

// 状態管理
let currentState = {
    userId: "",
    userName: "",
    status: "OFF_DUTY", // OFF_DUTY, ON_DUTY, BREAKING
    location: "",
    work: ""
};

// DOM要素
const elements = {
    time: document.getElementById('current-time'),
    date: document.getElementById('current-date'),
    userSelect: document.getElementById('user-select'),
    locationSelect: document.getElementById('location-select'),
    workSelect: document.getElementById('work-select'),
    statusText: document.getElementById('user-status-text'),
    btnIn: document.getElementById('btn-in'),
    btnOut: document.getElementById('btn-out'),
    btnBreakStart: document.getElementById('btn-break-start'),
    btnBreakEnd: document.getElementById('btn-break-end'),
    overlay: document.getElementById('overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalMessage: document.getElementById('modal-message'),
    modalClose: document.getElementById('modal-close')
};

// 初期化
function init() {
    updateClock();
    setInterval(updateClock, 1000);

    setupEventListeners();
    populateSelectors();

    // TODO: GASからスタッフ一覧を取得
    loadStaffList();
}

// リアルタイム時計
function updateClock() {
    const now = new Date();
    const options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' };
    elements.date.textContent = now.toLocaleDateString('ja-JP', options);
    elements.time.textContent = now.toLocaleTimeString('ja-JP', { hour12: false });
}

// セレクタの初期化
function populateSelectors() {
    // 場所
    MASTER_DATA.locations.forEach(loc => {
        const opt = document.createElement('option');
        opt.value = loc;
        opt.textContent = loc;
        elements.locationSelect.appendChild(opt);
    });

    // 作業（初期は共通）
    updateWorkList("共通");
}

function updateWorkList(category) {
    elements.workSelect.innerHTML = '<option value="">-- 作業を選択 --</option>';
    const works = category === "共通" ? MASTER_DATA.works["共通"] : [...MASTER_DATA.works["共通"], ...MASTER_DATA.works[category]];

    works.forEach(work => {
        const opt = document.createElement('option');
        opt.value = work;
        opt.textContent = work;
        elements.workSelect.appendChild(opt);
    });
}

// イベントリスナー
function setupEventListeners() {
    elements.userSelect.addEventListener('change', (e) => {
        currentState.userId = e.target.value;
        currentState.userName = e.target.options[e.target.selectedIndex].text;
        if (currentState.userId) {
            checkUserStatus(currentState.userId);
        } else {
            resetButtons();
            elements.statusText.textContent = "ユーザーを選択してください";
        }
    });

    elements.locationSelect.addEventListener('change', (e) => {
        currentState.location = e.target.value;
        // 場所に応じた作業リストの更新（簡易版）
        const category = e.target.value.includes("ハウス") ? "ビニールハウス" : (e.target.value.includes("田んぼ") ? "田んぼ" : "共通");
        updateWorkList(category);
    });

    elements.workSelect.addEventListener('change', (e) => {
        currentState.work = e.target.value;
    });

    elements.btnIn.addEventListener('click', () => punch('IN'));
    elements.btnOut.addEventListener('click', () => punch('OUT'));
    elements.btnBreakStart.addEventListener('click', () => punch('BREAK_START'));
    elements.btnBreakEnd.addEventListener('click', () => punch('BREAK_END'));

    elements.modalClose.addEventListener('click', () => {
        elements.overlay.style.display = 'none';
        // 打刻後にリロードして最新状態を反映
        location.reload();
    });
}

// ユーザー状態の確認（GASと連携予定）
function checkUserStatus(userId) {
    elements.statusText.textContent = "状態を確認中...";

    // 開発用ダミー：本来は google.script.run を使用
    setTimeout(() => {
        // ダミー状態: 未出勤
        currentState.status = "OFF_DUTY";
        updateUI();
    }, 500);
}

// UI更新
function updateUI() {
    resetButtons();

    if (!currentState.userId) return;

    if (currentState.status === "OFF_DUTY") {
        elements.statusText.textContent = `${currentState.userName}: 未出勤`;
        elements.btnIn.disabled = false;
    } else if (currentState.status === "ON_DUTY") {
        elements.statusText.textContent = `${currentState.userName}: 勤務中 (${currentState.location} / ${currentState.work})`;
        elements.btnOut.disabled = false;
        elements.btnBreakStart.disabled = false;
    } else if (currentState.status === "BREAKING") {
        elements.statusText.textContent = `${currentState.userName}: 休憩中`;
        elements.btnBreakEnd.disabled = false;
    }
}

function resetButtons() {
    elements.btnIn.disabled = true;
    elements.btnOut.disabled = true;
    elements.btnBreakStart.disabled = true;
    elements.btnBreakEnd.disabled = true;
}

// 打刻処理
function punch(type) {
    if (type === 'IN' && (!currentState.location || !currentState.work)) {
        alert("場所と作業内容を選択してください");
        return;
    }

    const now = new Date();
    // 5分単位切り捨て
    const roundedMinutes = Math.floor(now.getMinutes() / 5) * 5;
    const punchTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), roundedMinutes);

    const timeStr = `${punchTime.getHours().toString().padStart(2, '0')}:${punchTime.getMinutes().toString().padStart(2, '0')}`;

    const data = {
        userId: currentState.userId,
        userName: currentState.userName,
        type: type,
        time: punchTime.toISOString(),
        timeDisplay: timeStr,
        location: currentState.location,
        work: currentState.work
    };

    console.log("Punching:", data);
    showModal("通信中...", "データを送信しています。");

    // TODO: GASの google.script.run.recordPunch(data) を呼ぶ
    // 開発用ダミー
    setTimeout(() => {
        showModal("打刻完了", `${data.userName}さん、${type}（${timeStr}）を記録しました。`);
    }, 1000);
}

function showModal(title, message) {
    elements.modalTitle.textContent = title;
    elements.modalMessage.textContent = message;
    elements.overlay.style.display = 'flex';
}

function loadStaffList() {
    // ダミーデータ
    const staff = [
        { id: "001", name: "利用者A" },
        { id: "002", name: "利用者B" },
        { id: "003", name: "利用者C" }
    ];

    staff.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        elements.userSelect.appendChild(opt);
    });
}

// 実行
init();

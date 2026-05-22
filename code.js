/**
 * 農業勤怠管理システム - GAS REST APIバックエンド
 * GitHub Pagesのフロントエンドから fetch() で呼び出される
 */

/**
 * GETリクエストのハンドラ
 * パラメータ action で処理を振り分け
 */
function doGet(e) {
    const action = e.parameter.action;
    let result;

    try {
        switch (action) {
            case 'getTodayHistory':
                result = getTodayHistory();
                break;
            case 'getAllStaffStatus':
                result = getAllStaffStatus();
                break;
            case 'getStaffList':
                result = getStaffList();
                break;
            case 'getStaffDailyRecords':
                result = getStaffDailyRecords(e.parameter.date, e.parameter.staffId);
                break;
            case 'exportCSV':
                result = exportAttendanceCSV();
                return ContentService.createTextOutput(result)
                    .setMimeType(ContentService.MimeType.TEXT);
            default:
                result = { error: '不明なアクション: ' + action };
        }
    } catch (err) {
        result = { error: err.message };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * POSTリクエストのハンドラ
 * パラメータ action で処理を振り分け
 */
function doPost(e) {
    let result;

    try {
        const payload = JSON.parse(e.postData.contents);
        const action = payload.action;

        switch (action) {
            case 'recordPunchByNFC':
                result = recordPunchByNFC(payload.data);
                break;
            case 'registerNFCTag':
                result = registerNFCTag(payload.data);
                break;
            case 'updatePunchTime':
                result = updatePunchTime(payload.data);
                break;
            default:
                result = { error: '不明なアクション: ' + action };
        }
    } catch (err) {
        result = { error: err.message };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 初期セットアップ（手動実行）
 */
function setup() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sheets = [
        { name: '勤務記録', headers: ['日付', 'NFCシリアル', 'ID', '名前', '区分', '時間', '昼休み', 'おやつ休憩', '実働時間', '給与', '備考'] },
        { name: 'スタッフ名簿', headers: ['NFCシリアル', 'ID', '名前', '時給', '現在のステータス', '管理者', '昼休み設定(分)', 'おやつ休憩設定(分)'] },
        { name: '設定マスタ', headers: ['設定項目', '値', '備考'] }
    ];

    sheets.forEach(s => {
        let sheet = ss.getSheetByName(s.name);
        if (!sheet) {
            sheet = ss.insertSheet(s.name);
            sheet.getRange(1, 1, 1, s.headers.length).setValues([s.headers]).setBackground('#eeeeee');
        }
    });

    const settingSheet = ss.getSheetByName('設定マスタ');
    if (settingSheet.getLastRow() <= 1) {
        settingSheet.appendRow(['自動休憩設定(分)', '60', '午前午後にまたがる勤務の自動控除時間']);
        settingSheet.appendRow(['ACCESS_TOKEN', '', 'LINE Messaging API Access Token']);
    }
}

/**
 * NFCシリアル番号で打刻（自動判定方式）
 */
function recordPunchByNFC(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = ss.getSheetByName('スタッフ名簿');
    const punchSheet = ss.getSheetByName('勤務記録');

    // スタッフ検索
    const staffData = staffSheet.getDataRange().getValues();
    let staffRow = null;
    let staffRowIndex = -1;

    for (let i = 1; i < staffData.length; i++) {
        if (staffData[i][0].toString() === data.serialNumber.toString()) {
            staffRow = staffData[i];
            staffRowIndex = i;
            break;
        }
    }

    if (!staffRow) {
        return { error: '未登録のNFCタグです。登録モードで登録してください。' };
    }

    const staffId = staffRow[1];
    const staffName = staffRow[2];
    let currentStatus = staffRow[4] || 'OFF_DUTY';
    const timestamp = new Date(data.time);
    const todayStr = Utilities.formatDate(timestamp, "JST", "yyyy/MM/dd");

    // ===== 退勤忘れの自動補完処理 =====
    if (currentStatus === 'ON_DUTY') {
        const punchData = punchSheet.getDataRange().getValues();
        let lastInDateStr = null;
        
        // 過去のINレコードを逆順で検索
        for (let i = punchData.length - 1; i > 0; i--) {
            if (punchData[i][2].toString() === staffId.toString() && punchData[i][4] === 'IN') {
                lastInDateStr = punchData[i][0] instanceof Date
                    ? Utilities.formatDate(punchData[i][0], "JST", "yyyy/MM/dd")
                    : punchData[i][0].toString();
                break;
            }
        }

        // 最後のINが今日でない場合、退勤忘れとみなす
        if (lastInDateStr && lastInDateStr !== todayStr) {
            punchSheet.appendRow([
                lastInDateStr,
                data.serialNumber,
                staffId,
                staffName,
                'OUT',
                '17:00',
                '', // 昼休み
                '', // おやつ休憩
                '', // 実働
                '', // 給与
                '自動退勤(要確認)'
            ]);

            const lastRowVal = punchSheet.getLastRow();
            punchSheet.getRange(lastRowVal, 6).setNumberFormat('@').setValue('17:00');

            // 過去日時のDateオブジェクトを作成して成績計算
            const dummyDate = new Date(lastInDateStr + ' 17:00:00');
            calculatePerformance(staffId, dummyDate, staffSheet, punchSheet);

            // ステータスを一度OFF_DUTYにリセットすることで、後続処理で「今日の出勤」になる
            currentStatus = 'OFF_DUTY';
        }
    }

    // 自動判定
    let punchType, nextStatus, typeLabel;
    if (currentStatus === 'OFF_DUTY' || currentStatus === '') {
        punchType = 'IN';
        nextStatus = 'ON_DUTY';
        typeLabel = '出勤';
    } else if (currentStatus === 'ON_DUTY') {
        punchType = 'OUT';
        nextStatus = 'OFF_DUTY';
        typeLabel = '退勤';
    } else if (currentStatus === 'BREAKING') {
        punchType = 'BREAK_END';
        nextStatus = 'ON_DUTY';
        typeLabel = '休憩終了';
    } else {
        punchType = 'IN';
        nextStatus = 'ON_DUTY';
        typeLabel = '出勤';
    }



    punchSheet.appendRow([
        Utilities.formatDate(timestamp, "JST", "yyyy/MM/dd"),
        data.serialNumber,
        staffId,
        staffName,
        punchType,
        data.timeDisplay,
        '', // 昼休み
        '', // おやつ休憩
        '', // 実働
        '', // 給与
        ''  // 備考
    ]);

    // 時間列（F列）をテキスト形式に強制（スプレッドシートの自動Date変換を防止）
    const lastRow = punchSheet.getLastRow();
    punchSheet.getRange(lastRow, 6).setNumberFormat('@').setValue(data.timeDisplay);

    // ステータス更新
    staffSheet.getRange(staffRowIndex + 1, 5).setValue(nextStatus);

    // 退勤時は計算
    if (punchType === 'OUT') {
        calculatePerformance(staffId, timestamp, staffSheet, punchSheet);
    }

    // LINE通知
    sendLineNotification({ userName: staffName, type: punchType, timeDisplay: data.timeDisplay });

    return { name: staffName, type: typeLabel, time: data.timeDisplay };
}

/**
 * NFCタグの新規登録
 */
function registerNFCTag(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const staffSheet = ss.getSheetByName('スタッフ名簿');

    const existing = staffSheet.getDataRange().getValues();
    for (let i = 1; i < existing.length; i++) {
        if (existing[i][0].toString() === data.serialNumber.toString()) {
            return { error: 'このNFCタグは既に登録されています: ' + existing[i][2] };
        }
    }

    const newId = String(existing.length).padStart(3, '0');

    staffSheet.appendRow([
        data.serialNumber,
        newId,
        data.name,
        data.wage || 0,
        'OFF_DUTY',
        false
    ]);

    return { success: true, id: newId, name: data.name };
}

/**
 * スタッフ一覧
 */
function getStaffList() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('スタッフ名簿');
    const data = sheet.getDataRange().getValues();
    data.shift();

    return data.map(row => ({
        serialNumber: row[0],
        id: row[1],
        name: row[2],
        wage: row[3],
        status: row[4],
        isAdmin: row[5] === true || row[5] === 'TRUE' || row[5] === '○'
    }));
}

/**
 * 全スタッフ稼働状況
 */
function getAllStaffStatus() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('スタッフ名簿');
    const data = sheet.getDataRange().getValues();
    data.shift();

    return data.map(row => ({
        name: row[2],
        status: row[4] || 'OFF_DUTY'
    }));
}

/**
 * 本日の打刻履歴
 */
function getTodayHistory() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('勤務記録');
    const data = sheet.getDataRange().getValues();

    const today = Utilities.formatDate(new Date(), "JST", "yyyy/MM/dd");
    const typeLabels = { 'IN': '出勤', 'OUT': '退勤', 'BREAK_START': '休憩開始', 'BREAK_END': '休憩終了' };

    const records = [];
    for (let i = 1; i < data.length; i++) {
        const dateStr = data[i][0] instanceof Date
            ? Utilities.formatDate(data[i][0], "JST", "yyyy/MM/dd")
            : data[i][0].toString();
        if (dateStr === today) {
            // 時間列の変換（Date型・ISO文字列・通常文字列に対応）
            let timeVal = data[i][5];
            if (timeVal instanceof Date) {
                timeVal = Utilities.formatDate(timeVal, "JST", "HH:mm");
            } else {
                timeVal = String(timeVal);
                // ISO文字列（1899-12-30T...）が残っている場合のフォールバック
                if (timeVal.indexOf('T') !== -1 && timeVal.indexOf('1899') !== -1) {
                    try {
                        const d = new Date(timeVal);
                        // UTCからJST(+9時間)に変換
                        const h = (d.getUTCHours() + 9) % 24;
                        const m = d.getUTCMinutes();
                        timeVal = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
                    } catch (e) { /* そのまま */ }
                }
            }
            records.push({
                name: data[i][3],
                type: typeLabels[data[i][4]] || data[i][4],
                time: timeVal
            });
        }
    }
    return records;
}

/**
 * 実働時間と給与の計算（休憩なし・複数出退勤対応）
 * 退勤時に呼ばれ、直前の出勤レコードとペアリングして計算する
 */
function calculatePerformance(userId, outTime, staffSheet, punchSheet) {
    const today = Utilities.formatDate(outTime, "JST", "yyyy/MM/dd");
    const punchData = punchSheet.getDataRange().getValues();

    // 本日の該当ユーザーのレコードを行番号付きで取得
    const todayRecords = [];
    for (let i = 1; i < punchData.length; i++) {
        const dateStr = punchData[i][0] instanceof Date
            ? Utilities.formatDate(punchData[i][0], "JST", "yyyy/MM/dd")
            : punchData[i][0].toString();
        if (dateStr === today && punchData[i][2].toString() === userId.toString()) {
            todayRecords.push({ row: i, type: punchData[i][4], time: punchData[i][5] });
        }
    }

    // 最後のOUTレコードを探す（今回追加された退勤）
    let lastOutIdx = -1;
    for (let i = todayRecords.length - 1; i >= 0; i--) {
        if (todayRecords[i].type === 'OUT') {
            lastOutIdx = i;
            break;
        }
    }
    if (lastOutIdx < 0) return;

    // そのOUTの直前のINレコードを探す（ペアリング）
    let pairedInIdx = -1;
    for (let i = lastOutIdx - 1; i >= 0; i--) {
        if (todayRecords[i].type === 'IN') {
            pairedInIdx = i;
            break;
        }
    }
    if (pairedInIdx < 0) return;

    const inTimeMin = parseTime(todayRecords[pairedInIdx].time);
    const outTimeMin = parseTime(todayRecords[lastOutIdx].time);

    // 時給・休憩設定取得
    const staffData = staffSheet.getDataRange().getValues();
    const headers = staffData[0];
    const lunchSettingIndex = headers.indexOf('昼休み設定(分)');
    const snackSettingIndex = headers.indexOf('おやつ休憩設定(分)');
    
    const staffRow = staffData.find(row => row[1].toString() === userId.toString());
    const hourlyWage = staffRow ? staffRow[3] : 0;
    const lunchSetting = (staffRow && lunchSettingIndex > -1) ? (Number(staffRow[lunchSettingIndex]) || 0) : 0;
    const snackSetting = (staffRow && snackSettingIndex > -1) ? (Number(staffRow[snackSettingIndex]) || 0) : 0;

    let appliedLunch = 0;
    let appliedSnack = 0;

    // 昼休みの判定: 出勤が12:00以前 ＆ 退勤が13:00以降
    if (inTimeMin <= 12 * 60 && outTimeMin >= 13 * 60) {
        appliedLunch = lunchSetting;
    }

    // おやつ休憩の判定
    let snackCount = 0;
    if (inTimeMin <= 10 * 60 && outTimeMin >= 10 * 60 + 30) snackCount++; // 10:00〜10:30
    if (inTimeMin <= 15 * 60 && outTimeMin >= 15 * 60 + 30) snackCount++; // 15:00〜15:30
    
    if (snackCount > 0) {
        // 設定値の50%をかける（1時間なら30分ずつ）
        appliedSnack = (snackSetting / 2) * snackCount;
    }

    // 実働時間 = 退勤 - 出勤 - 昼休み - おやつ休憩
    let workMinutes = outTimeMin - inTimeMin - appliedLunch - appliedSnack;
    if (workMinutes < 0) workMinutes = 0;
    const workHours = workMinutes / 60;
    const salary = Math.floor(workHours * hourlyWage);

    // 該当OUTレコードの行に書き込み
    // 新構造: [0]日付, [1]シリアル, [2]ID, [3]名前, [4]区分, [5]時間, [6]昼休み, [7]おやつ休憩, [8]実働時間, [9]給与, [10]備考
    const sheetRow = todayRecords[lastOutIdx].row + 1; // 1-indexed
    punchSheet.getRange(sheetRow, 7).setValue(appliedLunch || 0); // G列
    punchSheet.getRange(sheetRow, 8).setValue(appliedSnack || 0); // H列
    punchSheet.getRange(sheetRow, 9).setValue(workHours.toFixed(2)); // I列
    punchSheet.getRange(sheetRow, 10).setValue(salary); // J列
}

/**
 * 時刻を分に変換（Date型・文字列型の両方に対応）
 */
function parseTime(timeVal) {
    if (timeVal instanceof Date) {
        // GASのDate型 → JST時刻を取得
        const formatted = Utilities.formatDate(timeVal, "JST", "HH:mm");
        const parts = formatted.split(':');
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    const parts = timeVal.toString().split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * LINE通知
 */
function sendLineNotification(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const settingSheet = ss.getSheetByName('設定マスタ');
    const settings = settingSheet.getDataRange().getValues();
    const tokenRecord = settings.find(row => row[0] === 'ACCESS_TOKEN');
    const token = tokenRecord ? tokenRecord[1] : '';

    if (!token) return;

    const typeLabels = { 'IN': '出勤', 'OUT': '退勤', 'BREAK_START': '休憩開始', 'BREAK_END': '休憩終了' };
    const message = `【勤怠通知】\n${data.userName}さんが${typeLabels[data.type] || data.type}しました。\n時刻: ${data.timeDisplay}`;

    try {
        UrlFetchApp.fetch('https://api.line.me/v2/bot/message/broadcast', {
            'method': 'post',
            'headers': {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
            },
            'payload': JSON.stringify({
                'messages': [{ 'type': 'text', 'text': message }]
            })
        });
    } catch (e) {
        console.error('LINE通知エラー:', e);
    }
}

/**
 * CSV出力
 */
function exportAttendanceCSV() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('勤務記録');
    const data = sheet.getDataRange().getValues();

    return data.map(row => {
        return row.map(cell => {
            if (cell instanceof Date) return Utilities.formatDate(cell, "JST", "yyyy/MM/dd");
            return `"${String(cell).replace(/"/g, '""')}"`;
        }).join(',');
    }).join('\n');
}

/**
 * スプレッドシート開いた時のイベント（カスタムメニュー追加）
 */
function onOpen() {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('勤怠管理')
        .addItem('月次集計を作成', 'showMonthlyAggregationPrompt')
        .addSeparator()
        .addItem('【重要】データベース仕様を更新', 'migrateDbForBreaks')
        .addToUi();
}

/**
 * 月次集計プロンプト
 */
function showMonthlyAggregationPrompt() {
    const ui = SpreadsheetApp.getUi();
    const result = ui.prompt('月次集計', '集計する年月を YYYY/MM 形式で入力してください（例: 2026/04）', ui.ButtonSet.OK_CANCEL);
    if (result.getSelectedButton() === ui.Button.OK) {
        const targetMonth = result.getResponseText().trim();
        if (!/^\d{4}\/\d{2}$/.test(targetMonth)) {
            ui.alert('エラー', '形式が正しくありません。YYYY/MM の形式で入力してください。', ui.ButtonSet.OK);
            return;
        }
        createMonthlyAggregation(targetMonth);
    }
}

/**
 * 月次集計＆不備チェック処理
 */
function createMonthlyAggregation(targetMonth) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const punchSheet = ss.getSheetByName('勤務記録');
    const staffSheet = ss.getSheetByName('スタッフ名簿');
    const ui = SpreadsheetApp.getUi();

    const punchData = punchSheet.getDataRange().getValues();
    const headers = punchData.shift();

    const errors = [];
    const targetRecords = [];
    
    // 対象月データの抽出と背景色のリセット
    punchData.forEach((row, index) => {
        const rowNum = index + 2;
        const dateStr = row[0] instanceof Date 
            ? Utilities.formatDate(row[0], "JST", "yyyy/MM/dd")
            : String(row[0]);
        
        if (dateStr.startsWith(targetMonth)) {
            targetRecords.push({
                rowNum: rowNum,
                date: dateStr,
                serial: row[1],
                staffId: String(row[2]),
                staffName: row[3],
                type: row[4],
                time: row[5],
                lunch: row[6],
                snack: row[7],
                worked: row[8],
                salary: row[9],
                remarks: String(row[10] || '')
            });
            // 背景色をリセット
            punchSheet.getRange(rowNum, 1, 1, headers.length).setBackground(null);
        }
    });

    if (targetRecords.length === 0) {
        ui.alert('結果', targetMonth + ' のデータは見つかりませんでした。', ui.ButtonSet.OK);
        return;
    }

    // スタッフリストと時給の取得
    const staffData = staffSheet.getDataRange().getValues();
    staffData.shift();
    const staffMap = {};
    staffData.forEach(row => {
        staffMap[String(row[1])] = {
            name: row[2],
            wage: Number(row[3]) || 0,
            lunchSetting: Number(row[6]) || 0,
            snackSetting: Number(row[7]) || 0,
            workDays: 0,
            totalMinutes: 0,
            totalSalary: 0,
            datesWorked: new Set()
        };
    });

    // ユーザーごと・日付ごとにグループ化
    const grouped = {};
    targetRecords.forEach(r => {
        if (!grouped[r.staffId]) grouped[r.staffId] = {};
        if (!grouped[r.staffId][r.date]) grouped[r.staffId][r.date] = [];
        grouped[r.staffId][r.date].push(r);
    });

    // 不備チェック＆再計算
    for (const [sId, dateMap] of Object.entries(grouped)) {
        for (const [date, recordsOfDay] of Object.entries(dateMap)) {
            let inRecords = recordsOfDay.filter(r => r.type === 'IN');
            let outRecords = recordsOfDay.filter(r => r.type === 'OUT');

            // 自動退勤フラグチェック
            const autoOuts = recordsOfDay.filter(r => r.remarks.includes('自動退勤(要確認)'));
            if (autoOuts.length > 0) {
                errors.push(`${date} 【${inRecords[0]?.staffName || outRecords[0]?.staffName || sId}】: 退勤忘れ（自動退勤17:00が適用されました）`);
                autoOuts.forEach(r => punchSheet.getRange(r.rowNum, 1, 1, headers.length).setBackground('#ffcccc'));
            }

            // 件数不一致エラー
            if (inRecords.length !== outRecords.length) {
                errors.push(`${date} 【${inRecords[0]?.staffName || outRecords[0]?.staffName || sId}】: 出勤と退勤の回数が一致しません (IN:${inRecords.length}回, OUT:${outRecords.length}回)`);
                recordsOfDay.forEach(r => punchSheet.getRange(r.rowNum, 1, 1, headers.length).setBackground('#ffcccc'));
            }

            // 再計算 (ペアになっている分だけ計算)
            if (staffMap[sId]) {
                const pairs = Math.min(inRecords.length, outRecords.length);
                if (pairs > 0) {
                    staffMap[sId].datesWorked.add(date);
                }
                for (let i = 0; i < pairs; i++) {
                    const inMin = parseTime(inRecords[i].time);
                    const outMin = parseTime(outRecords[i].time);
                    
                    let appliedLunch = 0;
                    if (inMin <= 12 * 60 && outMin >= 13 * 60) {
                        appliedLunch = staffMap[sId].lunchSetting;
                    }

                    let snackCount = 0;
                    if (inMin <= 10 * 60 && outMin >= 10 * 60 + 30) snackCount++;
                    if (inMin <= 15 * 60 && outMin >= 15 * 60 + 30) snackCount++;
                    let appliedSnack = (staffMap[sId].snackSetting / 2) * snackCount;

                    let workedMinutes = outMin - inMin - appliedLunch - appliedSnack;
                    if (workedMinutes < 0) workedMinutes = 0;
                    
                    const calculatedWorkHours = (workedMinutes / 60).toFixed(2);
                    const calculatedSalary = Math.floor((workedMinutes / 60) * staffMap[sId].wage);
                    
                    staffMap[sId].totalMinutes += workedMinutes;

                    // 対象レコード(OUT)の値と比較・更新
                    const outRec = outRecords[i];
                    let needsUpdate = false;
                    let existingRemarks = outRec.remarks;

                    const isLunchEmpty = outRec.lunch === '';
                    const isSnackEmpty = outRec.snack === '';
                    const isWorkedEmpty = outRec.worked === '';
                    const isSalaryEmpty = outRec.salary === '';

                    if (isLunchEmpty || Number(outRec.lunch) !== appliedLunch) needsUpdate = true;
                    if (isSnackEmpty || Number(outRec.snack) !== appliedSnack) needsUpdate = true;
                    if (isWorkedEmpty || Number(outRec.worked).toFixed(2) !== calculatedWorkHours) needsUpdate = true;
                    if (isSalaryEmpty || Number(outRec.salary) !== calculatedSalary) needsUpdate = true;

                    if (needsUpdate) {
                        const rowNum = outRec.rowNum;
                        punchSheet.getRange(rowNum, 7).setValue(appliedLunch || 0);
                        punchSheet.getRange(rowNum, 8).setValue(appliedSnack || 0);
                        punchSheet.getRange(rowNum, 9).setValue(calculatedWorkHours);
                        punchSheet.getRange(rowNum, 10).setValue(calculatedSalary);

                        // 備考に追記
                        if (!existingRemarks.includes('月次集計にて自動補完・更新済')) {
                            existingRemarks = existingRemarks ? existingRemarks + ' / 月次集計にて自動補完・更新済' : '月次集計にて自動補完・更新済';
                            punchSheet.getRange(rowNum, 11).setValue(existingRemarks);
                        }
                    }
                }
            }
        }
    }

    // 集計シート作成
    const sheetName = '集計_' + targetMonth.replace('/', '');
    let aggSheet = ss.getSheetByName(sheetName);
    if (!aggSheet) {
        aggSheet = ss.insertSheet(sheetName);
    } else {
        aggSheet.clear();
    }

    // シート書き込みデータの準備
    const outData = [];
    outData.push([`【${targetMonth} 月次集計】`]);
    outData.push([]);
    
    if (errors.length > 0) {
        outData.push(['⚠️ データ不備（エラー一覧）']);
        errors.forEach(e => outData.push([e]));
        outData.push(['※元の「勤務記録」シートで赤くなっている行を確認・修正してから、再度月次集計を実行してください。']);
    } else {
        outData.push(['✅ データ不備はありませんでした。']);
    }

    outData.push([]);
    outData.push(['--- 集計結果 --------------------------------------------------']);
    outData.push(['ID', 'スタッフ名', '出勤日数', '総実働時間(時間)', '時給', '合計給与額']);

    for (const sId in staffMap) {
        const d = staffMap[sId];
        if (d.datesWorked.size > 0) {
            const totalHours = d.totalMinutes / 60;
            const totalSalary = Math.floor(totalHours * d.wage);
            outData.push([
                sId, 
                d.name, 
                d.datesWorked.size, 
                totalHours.toFixed(2), 
                d.wage, 
                totalSalary
            ]);
        }
    }

    // 書き出しとフォーマット
    const maxCols = Math.max(...outData.map(r => r.length));
    // 行幅を揃えるために空配列を追加
    outData.forEach(r => {
        while(r.length < maxCols) r.push('');
    });

    aggSheet.getRange(1, 1, outData.length, maxCols).setValues(outData);
    
    aggSheet.getRange("A1").setFontWeight("bold").setFontSize(14);
    if (errors.length > 0) {
        aggSheet.getRange(3, 1).setFontColor("red").setFontWeight("bold");
    } else {
        aggSheet.getRange(3, 1).setFontColor("green").setFontWeight("bold");
    }
    
    ui.alert('完了', `月次集計を作成しました。\n${sheetName} シートをご確認ください。エラーがある場合は「勤務記録」シートの色付け箇所を確認してください。`, ui.ButtonSet.OK);
}

/**
 * 【重要】データベースの列仕様を自動更新する
 */
function migrateDbForBreaks() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ui = SpreadsheetApp.getUi();
    
    const staffSheet = ss.getSheetByName('スタッフ名簿');
    const punchSheet = ss.getSheetByName('勤務記録');
    
    if (!staffSheet || !punchSheet) {
        ui.alert('エラー', '必要なシートが見つかりません。', ui.ButtonSet.OK);
        return;
    }
    
    // ====== 1. スタッフ名簿の更新 ======
    const staffHeaders = staffSheet.getRange(1, 1, 1, staffSheet.getLastColumn()).getValues()[0];
    let staffNeedsUpdate = !staffHeaders.includes('昼休み設定(分)');
    
    if (staffNeedsUpdate) {
        // 右端に2列追加
        const newColStart = staffHeaders.length + 1;
        staffSheet.getRange(1, newColStart).setValue('昼休み設定(分)');
        staffSheet.getRange(1, newColStart + 1).setValue('おやつ休憩設定(分)');
        staffSheet.getRange(1, newColStart, 1, 2).setBackground('#eeeeee');
        
        // 既存行にデフォルト60をセット
        const lastRow = staffSheet.getLastRow();
        if (lastRow > 1) {
            const defaults = [];
            for (let i = 0; i < lastRow - 1; i++) {
                defaults.push([60, 60]);
            }
            staffSheet.getRange(2, newColStart, defaults.length, 2).setValues(defaults);
        }
    }
    
    // ====== 2. 勤務記録の更新 ======
    const punchHeaders = punchSheet.getRange(1, 1, 1, punchSheet.getLastColumn()).getValues()[0];
    let punchNeedsUpdate = !punchHeaders.includes('昼休み');
    
    if (punchNeedsUpdate) {
        // 「実働時間」の前に2列挿入する
        const colG = punchHeaders.indexOf('実働時間') + 1;
        if (colG > 0) {
            punchSheet.insertColumns(colG, 2);
            punchSheet.getRange(1, colG).setValue('昼休み');
            punchSheet.getRange(1, colG + 1).setValue('おやつ休憩');
            punchSheet.getRange(1, colG, 1, 2).setBackground('#eeeeee');
        }
    }
    
    if (staffNeedsUpdate || punchNeedsUpdate) {
        ui.alert('更新完了', 'データベースの列を「休憩対応版」に更新しました。', ui.ButtonSet.OK);
    } else {
        ui.alert('確認', 'すでに最新の仕様に更新されています。', ui.ButtonSet.OK);
    }
}

/**
 * 指定日付・スタッフの打刻データを取得
 */
function getStaffDailyRecords(targetDateStr, staffId) {
    if (!targetDateStr || !staffId) {
        return { error: 'パラメータが不足しています' };
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('勤務記録');
    const data = sheet.getDataRange().getValues();
    const typeLabels = { 'IN': '出勤', 'OUT': '退勤', 'BREAK_START': '休憩開始', 'BREAK_END': '休憩終了' };
    
    const records = [];
    for (let i = 1; i < data.length; i++) {
        const rowDateStr = data[i][0] instanceof Date
            ? Utilities.formatDate(data[i][0], "JST", "yyyy/MM/dd")
            : data[i][0].toString();
            
        if (rowDateStr === targetDateStr && data[i][2].toString() === staffId.toString()) {
            let timeVal = data[i][5];
            if (timeVal instanceof Date) {
                timeVal = Utilities.formatDate(timeVal, "JST", "HH:mm");
            } else {
                timeVal = String(timeVal);
                if (timeVal.indexOf('T') !== -1 && timeVal.indexOf('1899') !== -1) {
                    try {
                        const d = new Date(timeVal);
                        const h = (d.getUTCHours() + 9) % 24;
                        const m = d.getUTCMinutes();
                        timeVal = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
                    } catch (e) { /* そのまま */ }
                }
            }
            
            records.push({
                rowNum: i + 1,
                typeRaw: data[i][4],
                typeLabel: typeLabels[data[i][4]] || data[i][4],
                time: timeVal
            });
        }
    }
    return records;
}

/**
 * 時間の上書きと再計算
 */
function updatePunchTime(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const punchSheet = ss.getSheetByName('勤務記録');
    const staffSheet = ss.getSheetByName('スタッフ名簿');
    
    for (const update of data.updates) {
        punchSheet.getRange(update.rowNum, 6).setNumberFormat('@').setValue(update.newTime);
        
        let existingRemarks = punchSheet.getRange(update.rowNum, 11).getValue();
        existingRemarks = String(existingRemarks || '');
        if (!existingRemarks.includes('管理者による手動修正')) {
             existingRemarks = existingRemarks ? existingRemarks + ' / 管理者による手動修正' : '管理者による手動修正';
             punchSheet.getRange(update.rowNum, 11).setValue(existingRemarks);
        }
    }
    
    const targetDateStr = data.date;
    const staffId = data.staffId;
    
    const staffData = staffSheet.getDataRange().getValues();
    const staffHeaders = staffData[0];
    const staffRow = staffData.find(row => row[1].toString() === staffId.toString());
    if (!staffRow) return { success: true, message: '時間は更新されましたが、再計算できませんでした' };
    
    const wage = Number(staffRow[3]) || 0;
    const lunchSetting = Number(staffRow[staffHeaders.indexOf('昼休み設定(分)')]) || 0;
    const snackSetting = Number(staffRow[staffHeaders.indexOf('おやつ休憩設定(分)')]) || 0;
    
    const punchData = punchSheet.getDataRange().getValues();
    const todayRecords = [];
    for (let i = 1; i < punchData.length; i++) {
        const rowDateStr = punchData[i][0] instanceof Date
            ? Utilities.formatDate(punchData[i][0], "JST", "yyyy/MM/dd")
            : punchData[i][0].toString();
        if (rowDateStr === targetDateStr && punchData[i][2].toString() === staffId.toString()) {
            todayRecords.push({ rowNum: i + 1, type: punchData[i][4], time: punchData[i][5] });
        }
    }
    
    const inRecords = todayRecords.filter(r => r.type === 'IN');
    const outRecords = todayRecords.filter(r => r.type === 'OUT');
    const pairs = Math.min(inRecords.length, outRecords.length);
    
    for (let i = 0; i < pairs; i++) {
        const inMin = parseTime(inRecords[i].time);
        const outMin = parseTime(outRecords[i].time);
        
        let appliedLunch = 0;
        if (inMin <= 12 * 60 && outMin >= 13 * 60) appliedLunch = lunchSetting;

        let snackCount = 0;
        if (inMin <= 10 * 60 && outMin >= 10 * 60 + 30) snackCount++;
        if (inMin <= 15 * 60 && outMin >= 15 * 60 + 30) snackCount++;
        let appliedSnack = (snackSetting / 2) * snackCount;

        let workedMinutes = outMin - inMin - appliedLunch - appliedSnack;
        if (workedMinutes < 0) workedMinutes = 0;
        
        const workHours = (workedMinutes / 60).toFixed(2);
        const salary = Math.floor((workedMinutes / 60) * wage);
        
        const sheetRow = outRecords[i].rowNum;
        punchSheet.getRange(sheetRow, 7).setValue(appliedLunch || 0);
        punchSheet.getRange(sheetRow, 8).setValue(appliedSnack || 0);
        punchSheet.getRange(sheetRow, 9).setValue(workHours);
        punchSheet.getRange(sheetRow, 10).setValue(salary);
    }
    
    return { success: true };
}

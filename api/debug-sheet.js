const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const sheetId = process.env.GOOGLE_SHEET_ID;

  const report = {
    env: {
      GOOGLE_SHEET_ID:              sheetId ? `✅ 設定済み (${sheetId.slice(0, 8)}...)` : '❌ 未設定',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: email   ? `✅ 設定済み (${email})`                  : '❌ 未設定',
      GOOGLE_PRIVATE_KEY:           rawKey  ? `✅ 設定済み (${rawKey.length}文字)`       : '❌ 未設定',
      PRIVATE_KEY_STARTS_OK:        rawKey.includes('BEGIN') ? '✅ -----BEGIN が含まれる' : '❌ -----BEGIN がない（コピーミスの可能性）',
      PRIVATE_KEY_NEWLINES:         rawKey.includes('\\n')   ? '✅ \\n 形式で設定済み'   : (rawKey.includes('\n') ? '✅ 実改行で設定済み' : '⚠️ 改行が見当たらない'),
    },
    sheetAccess: null,
    error: null,
  };

  if (!email || !rawKey || !sheetId) {
    return res.status(200).json({ ...report, error: '環境変数が不足しています。上の env を確認してください。' });
  }

  try {
    const key = rawKey.replace(/\\n/g, '\n');
    const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    report.sheetAccess = {
      status:    '✅ 接続成功',
      title:     meta.data.properties.title,
      sheetId:   sheetId,
      sheetTabs: meta.data.sheets.map(s => s.properties.title),
    };
  } catch (err) {
    report.error = err.message;
    report.sheetAccess = {
      status: '❌ 接続失敗',
      hint: err.message.includes('not found')
        ? 'シートIDが違うか、サービスアカウントに共有されていません'
        : err.message.includes('permission')
        ? 'サービスアカウントへの共有が「編集者」になっていません'
        : err.message.includes('invalid_grant') || err.message.includes('DECODER routines')
        ? 'private_key のコピーが壊れています。JSONファイルから再コピーしてください'
        : 'エラー詳細を確認してください',
    };
  }

  return res.status(200).json(report);
};

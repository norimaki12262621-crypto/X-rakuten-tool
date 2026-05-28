const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const email  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const sheetId = (process.env.GOOGLE_SHEET_ID || '').trim();

  // シートIDの詳細チェック
  const idAnalysis = {
    vercelに設定されている値: sheetId || '(未設定)',
    文字数: sheetId.length,
    期待される文字数: '44文字',
    文字数OK: sheetId.length === 44 ? '✅' : `❌ (${sheetId.length}文字 — 多すぎ or 少なすぎ)`,
    先頭8文字: sheetId.slice(0, 8),
    末尾8文字: sheetId.slice(-8),
    スペース混入: /\s/.test(sheetId) ? '❌ スペースまたは改行が含まれています' : '✅ なし',
    使えない文字: /[^A-Za-z0-9_-]/.test(sheetId) ? '❌ 英数字・_・- 以外の文字が含まれています' : '✅ なし',
  };

  const report = {
    sheetId_analysis: idAnalysis,
    env: {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: email  ? `✅ ${email}`           : '❌ 未設定',
      GOOGLE_PRIVATE_KEY:           rawKey ? `✅ ${rawKey.length}文字` : '❌ 未設定',
      PRIVATE_KEY_BEGIN: rawKey.includes('BEGIN') ? '✅ -----BEGIN あり' : '❌ -----BEGIN なし（コピーミス）',
      PRIVATE_KEY_END:   rawKey.includes('END')   ? '✅ -----END あり'   : '❌ -----END なし（途中で切れてる）',
    },
    sheetAccess: null,
    error: null,
    fix: null,
  };

  if (!email || !rawKey || !sheetId) {
    report.fix = '環境変数が未設定です。Vercel → Settings → Environment Variables を確認してください。';
    return res.status(200).json(report);
  }

  try {
    const key = rawKey.replace(/\\n/g, '\n');
    const auth = new google.auth.JWT(email, null, key, ['https://www.googleapis.com/auth/spreadsheets']);
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const sheetName = meta.data.sheets[0].properties.title;
    report.sheetAccess = {
      status:        '✅ 接続成功',
      title:         meta.data.properties.title,
      使用するシート名: sheetName,
      全シート一覧:    meta.data.sheets.map(s => s.properties.title),
    };
  } catch (err) {
    report.error = err.message;

    if (err.message.includes('not found') || err.message.includes('NOT_FOUND')) {
      report.sheetAccess = { status: '❌ シートが見つかりません (404)' };
      report.fix = [
        '原因は2つのどちらかです：',
        '【原因A】GOOGLE_SHEET_IDが間違っている',
        `  → Vercelに設定されているID: "${sheetId}"`,
        `  → 文字数: ${sheetId.length}文字（正しくは44文字）`,
        '  → スプレッドシートのURLを開いて /d/ と /edit の間の文字列だけをコピーしてください',
        '【原因B】サービスアカウントにスプレッドシートを共有していない',
        `  → 共有すべきメールアドレス: ${email}`,
        '  → スプレッドシートを開いて「共有」→ 上記メールアドレスを追加 →「編集者」で保存',
        '修正後は Vercel → Deployments → Redeploy してください',
      ].join('\n');
    } else if (err.message.includes('permission') || err.message.includes('PERMISSION_DENIED')) {
      report.sheetAccess = { status: '❌ 権限エラー (403)' };
      report.fix = `スプレッドシートの共有が不完全です。\n共有すべきメールアドレス: ${email}\nスプレッドシートを開いて「共有」→ 上記メールを「編集者」で追加してください。`;
    } else if (err.message.includes('invalid_grant') || err.message.includes('DECODER')) {
      report.sheetAccess = { status: '❌ 認証キーエラー' };
      report.fix = 'GOOGLE_PRIVATE_KEYが壊れています。JSONファイルの"private_key"の値をVercelに再設定してください。';
    } else {
      report.sheetAccess = { status: '❌ 不明なエラー' };
    }
  }

  return res.status(200).json(report);
};

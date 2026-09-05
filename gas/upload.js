/**
 * Google Apps Script — upload ImgBB (chave fica só aqui).
 *
 * 1. Cole este arquivo num projeto GAS.
 * 2. Project Settings > Script properties:
 *    IMGBB_API_KEY = sua chave
 * 3. Deploy > New deployment > Web app
 *    Execute as: Me
 *    Who has access: Anyone
 * 4. Copie a URL e coloque no .env:
 *    VITE_UPLOAD_URL=https://script.google.com/macros/s/.../exec
 *
 * A API do ImgBB não coloca a foto num álbum. Organize no site se quiser.
 */

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function doPost(e) {
  const key = PropertiesService.getScriptProperties().getProperty('IMGBB_API_KEY')
  if (!key) return jsonOut({ error: 'IMGBB_API_KEY ausente' })

  const body = JSON.parse((e.postData && e.postData.contents) || '{}')
  if (!body.image) return jsonOut({ error: 'Imagem ausente' })

  const payload = {
    key: key,
    image: body.image,
    name: body.name || 'vitrinezap'
  }

  const res = UrlFetchApp.fetch('https://api.imgbb.com/1/upload', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true
  })
  const parsed = JSON.parse(res.getContentText() || '{}')
  const url = parsed.data && (parsed.data.display_url || parsed.data.url)
  if (!url) {
    const message = (parsed.error && parsed.error.message) || 'ImgBB recusou o upload'
    return jsonOut({ error: message })
  }
  return jsonOut({
    url: url,
    thumb: parsed.data.thumb && parsed.data.thumb.url
  })
}

function doGet() {
  return jsonOut({ ok: true, service: 'vitrinezap-upload' })
}

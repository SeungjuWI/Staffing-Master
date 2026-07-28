// JD EXECUTION 원장 진단 — 충원 완료 공고의 Job Status 실제 값 + 상태값 분포 (값 자체는 비민감)
import { google } from 'googleapis'

const ID = process.env.MASTER_SHEET_ID || '1mR1_-a3LmjxAbbox3tTKBu6WYwDbfBYKmPB6TP9EnKI'
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() })

const meta = await sheets.spreadsheets.get({ spreadsheetId: ID })
console.log('탭:', meta.data.sheets.map(s => s.properties.title).join(' | '))

const res = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: "'JD EXECUTION'!A1:N" })
const rows = res.data.values || []
const hi = rows.findIndex(r => (r || []).some(c => /job id/i.test(String(c || ''))))
const head = rows[hi] || []
console.log('헤더행:', hi + 1)
console.log('헤더:', head.map((h, i) => `${String.fromCharCode(65 + i)}(${i})=${h}`).join(' · '))

const col = re => head.findIndex(h => re.test(String(h || '')))
const cId = col(/job id/i), cCo = col(/company/i), cT = col(/job title/i)
const cHc = col(/headcount/i), cSt = col(/job status/i)

const body = rows.slice(hi + 1).filter(r => (r || [])[cId])
const dist = {}
body.forEach(r => { const s = String(r[cSt] || '(빈칸)').trim(); dist[s] = (dist[s] || 0) + 1 })
console.log('\n== Job Status 값 분포 ==')
Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v}건  "${k}"`))

console.log('\n== 충원 완료 3건 원장 상태 ==')
for (const code of ['NX501', 'LM1001', 'WP602']) {
  const r = body.find(x => String(x[cId] || '').trim().toUpperCase().startsWith(code))
  console.log(r
    ? `  ${code} | ${r[cCo]} | ${String(r[cT] || '').slice(0, 40)} | Headcount=${r[cHc]} | Job Status="${r[cSt] || '(빈칸)'}"`
    : `  ${code} | 원장 행 없음`)
}

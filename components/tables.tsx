import type { Channel, CompanyPerf, JdRow } from '@/lib/types'
import { channelLabel, fmtInt, fmtKrw, fmtUsd } from '@/lib/fmt'
import { Meter } from './viz'

export function ChannelTable({ channels }: { channels: Channel[] }) {
  const sum = (f: (c: Channel) => number) => channels.reduce((s, c) => s + f(c), 0)
  const totalSpend = channels.some(c => c.spendKrw != null) ? sum(c => c.spendKrw || 0) : null
  const totalPeople = sum(c => c.people)
  const totalHires = sum(c => c.hires)
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>채널</th>
            <th>지원자</th>
            <th>지원 건</th>
            <th>스크리닝 합격</th>
            <th>면접</th>
            <th>입사</th>
            <th>지출</th>
            <th>지원자당 비용</th>
            <th>채용당 비용</th>
          </tr>
        </thead>
        <tbody>
          {channels.map(c => (
            <tr key={c.key}>
              <td className="tname">{channelLabel(c.key)}</td>
              <td>{fmtInt(c.people)}</td>
              <td>{c.applications ? fmtInt(c.applications) : <span className="dim">–</span>}</td>
              <td>{fmtInt(c.docPass)}</td>
              <td>{fmtInt(c.interviews)}</td>
              <td>{fmtInt(c.hires)}</td>
              <td>{c.spendKrw != null ? fmtKrw(c.spendKrw) : <span className="dim">–</span>}</td>
              <td>{c.cpaKrw != null ? fmtKrw(c.cpaKrw) : <span className="dim">–</span>}</td>
              <td>{c.costPerHireKrw != null ? fmtKrw(c.costPerHireKrw) : <span className="dim">–</span>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>합계</td>
            <td>{fmtInt(totalPeople)}</td>
            <td>{fmtInt(sum(c => c.applications))}</td>
            <td>{fmtInt(sum(c => c.docPass))}</td>
            <td>{fmtInt(sum(c => c.interviews))}</td>
            <td>{fmtInt(totalHires)}</td>
            <td>{totalSpend != null ? fmtKrw(totalSpend) : '–'}</td>
            <td>{totalSpend != null && totalPeople > 0 ? fmtKrw(totalSpend / totalPeople) : '–'}</td>
            <td>{totalSpend != null && totalHires > 0 ? fmtKrw(totalSpend / totalHires) : '–'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export function JdTable({ jds }: { jds: JdRow[] }) {
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>공고</th>
            <th>상태</th>
            <th>TO</th>
            <th>지원 건</th>
            <th>지원자</th>
            <th>스크리닝 합격</th>
            <th>기업 전달</th>
            <th>면접</th>
            <th>오퍼</th>
            <th>입사</th>
            <th>충원율</th>
          </tr>
        </thead>
        <tbody>
          {jds.map(j => (
            <tr key={j.code}>
              <td>
                <span className="tname">{j.company}</span>{' '}
                <span className="tsub">{j.code}{j.title ? ` · ${j.title}` : ''}</span>
              </td>
              <td>
                <span className={j.open ? 'tag open' : 'tag closed'} title={j.status || undefined}>
                  {j.open ? '진행 중' : '마감'}
                </span>
              </td>
              <td>{j.headcount != null ? fmtInt(j.headcount) : <span className="dim">–</span>}</td>
              <td>{fmtInt(j.apps)}</td>
              <td>{fmtInt(j.people)}</td>
              <td>{fmtInt(j.docPass)}</td>
              <td>{fmtInt(j.delivered)}</td>
              <td>{fmtInt(j.interviews)}</td>
              <td>{fmtInt(j.offer)}</td>
              <td>{fmtInt(j.hires)}</td>
              <td>
                <Meter ratio={j.headcount ? j.hires / j.headcount : null} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CompanyTable({ companies }: { companies: CompanyPerf[] }) {
  return (
    <div className="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>기업</th>
            <th>입사</th>
            <th>재직 중</th>
            <th>총 매출</th>
            <th>이익</th>
          </tr>
        </thead>
        <tbody>
          {companies.map(c => (
            <tr key={c.company}>
              <td className="tname">{c.company}</td>
              <td>{fmtInt(c.hires)}</td>
              <td>{fmtInt(c.working)}</td>
              <td>{fmtUsd(c.revenueUsd)}</td>
              <td>{fmtUsd(c.profitUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

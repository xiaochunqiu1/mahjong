import { useEffect, useState } from 'react';
import { loadRecords, type RecordEntry } from '../game/controller.js';

export function History({ go }: { go: (p: string) => void }) {
  const [list, setList] = useState<RecordEntry[]>([]);
  useEffect(() => { setList(loadRecords()); }, []);
  return (
    <div className="stage simple stage-portrait">
      <span className="back" onClick={() => go('')}>‹ 返回</span>
      <h2>战绩（最近 {list.length}/20 场）</h2>
      <div className="body">
        {list.length === 0 ? (
          <p style={{ opacity: .7 }}>还没有对局记录，先去打一局吧。</p>
        ) : (
          <table className="hist">
            <thead><tr><th>时间</th><th>局数</th><th>名次</th><th>胡</th><th>积分</th></tr></thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i}>
                  <td>{r.date.slice(5, -3)}</td>
                  <td>{r.rounds} 局</td>
                  <td>{r.rank} 名</td>
                  <td>{r.winCount}</td>
                  <td className={r.score >= 0 ? 'pos' : 'neg'}>{r.score >= 0 ? '+' + r.score : r.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

# Classic first view prioritizes news

- Status: active
- Created: 2026-09-15
- Last verified: 2026-09-15
- Source task: C-004

## Decision

Classicトップ上部は `Header -> Compact Hero -> 更新状態 -> 今日のインターネット` の順に保つ。Game Hubを含む他sectionは「今日のインターネット」より後へ置き、主要ニュースを初期viewportから確認できる構成を優先する。

Heroはブランドコピーを維持しつつ、ニュース到達を妨げる固定最小高や未使用カラムを持たせない。右側を使う場合も、新しいdata生成を追加せず既存の説明・導線だけで構成する。

## Reason

Classicの主目的は「今日何が起きたかをすぐ把握すること」であり、案内sectionや装飾が最初のニュースより先に大きな高さを占有すると、利用目的への到達が遅れるため。

## Alternatives considered

- 大型Heroを維持する: ニュースが初期viewport外になるため不採用。
- Game Hubをニュースより前に置く: 補助導線が主目的より優先されるため不採用。
- Hero右側へ新しいTOP topic dataを追加する: data flowと失敗点を増やすため不採用。

## Evidence

- `index.html`: 上部section順とGame Hub導線
- `styles.css`: Compact HeroとGame Hubのpresentation
- C-004 browser verification: 390x844、430x932、1440x900でsection位置、overflow、consoleを確認

## Reverification

トップ最上部で「今日のインターネット」の見出しと最初のカードが確認できること、Game HubリンクとMobile menuが維持されること、横overflowがないことを代表viewportで確認する。

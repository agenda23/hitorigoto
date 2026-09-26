import type { Lang } from './i18n'

export type GuideSection = {
  /** Anchor: other parts of the app can open the guide scrolled to this section. */
  id?: string
  heading: string
  body?: string
  items?: string[]
  /** Label / explanation pairs, shown as a compact table. */
  facts?: [string, string][]
}
export type ModelStatusKey = 'loading' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api'

export type GuideContent = {
  open: string
  title: string
  tabs: [string, string, string]
  back: string
  next: string
  start: string
  closeHint: string
  about: GuideSection[]
  setup: {
    intro: string
    statusLabel: string
    status: Record<ModelStatusKey, string>
    stepsHeading: string
    steps: { title: string; body: string }[]
    requirementsHeading: string
    requirements: [string, string][]
    checkHeading: string
    check: string
    troubleHeading: string
    trouble: string[]
  }
  usage: GuideSection[]
}

const ja: GuideContent = {
  open: '使い方',
  title: 'Hitorigoto の使い方',
  tabs: ['はじめに', '初回設定', '使い方'],
  back: '戻る',
  next: '次へ',
  start: 'はじめる',
  closeHint: 'このガイドは、ヘッダーの「使い方」からいつでも開けます。',
  about: [
    {
      heading: 'Hitorigoto とは',
      body: 'Chrome に内蔵されたオンデバイス AI（Gemini Nano）だけで動く、サーバーを持たないチャットアプリです。話し相手は手元のモデルだけ。名前の「ひとりごと」は、入力が端末の外に出ないことを表しています。',
    },
    {
      heading: '入力も履歴も、端末の外に出ません',
      body: '入力・履歴・添付した画像は、すべてこのブラウザの中だけで処理・保存されます。アカウントも従量課金も不要で、モデルのダウンロード後はオフラインでも使えます。ヘッダーの「送信 0」を押すと、外部に送信されないことを自分で確かめられます。',
    },
    {
      heading: '得意なこと・苦手なこと',
      items: [
        '得意: 文章の推敲、要約、分類、アイデア出しなど、短めの作業。',
        '苦手: 長い推論、正確な事実の想起、最新の情報。回答は必ずご自身で確認してください。',
      ],
    },
  ],
  setup: {
    intro: 'このアプリを使うには、Chrome のオンデバイスモデルの準備が必要です。必要なのは初回だけで、2 回目以降はそのまま使えます。',
    statusLabel: 'いまの状態',
    status: {
      loading: '確認しています…',
      available: 'モデルは使える状態です。「はじめる」でチャットを始められます。',
      downloadable: 'モデルのダウンロードが必要です。このガイドを閉じて、画面の「モデルをダウンロード」ボタンを押してください。',
      downloading: 'モデルをダウンロード中です。完了まで画面を開いたままお待ちください。',
      unavailable: 'この端末ではモデルを使えない可能性があります。下の動作要件を確認してください。',
      'no-api': 'この Chrome では Prompt API が見つかりません。Chrome 148 以上のデスクトップ版に更新してください。',
    },
    stepsHeading: '初回の手順',
    steps: [
      { title: 'デスクトップ版の Chrome を用意する', body: 'Chrome 148 以上（Windows 10/11、macOS 13 以降、Linux、Chromebook Plus）。Android と iOS には対応していません。' },
      { title: '動作要件を確認する', body: '空き容量・GPU またはメモリ・回線など、下の表の条件を満たしている必要があります。' },
      { title: 'モデルをダウンロードする', body: '画面に表示される「モデルをダウンロード」ボタンを押します。ダウンロードの開始にはこのボタン操作が必要です。数 GB あるため、従量制でない回線を推奨します。完了まで画面を開いたままお待ちください。' },
      { title: 'チャットを始める', body: 'ダウンロードが終わると、自動でチャット画面に切り替わります。以降はネットワークなしで動きます。' },
    ],
    requirementsHeading: '動作要件',
    requirements: [
      ['対応 OS', 'Windows 10/11、macOS 13 以降、Linux、Chromebook Plus'],
      ['空き容量', 'Chrome プロファイルのあるドライブに 22GB 以上。ダウンロード後に空きが 10GB を下回ると、モデルは削除されます。'],
      ['GPU', 'VRAM が 4GB 超'],
      ['GPU がない場合', 'RAM 16GB 以上、かつ 4 コア以上'],
      ['回線', '従量制でない接続（通信が必要なのは初回のダウンロード時だけ）'],
      ['言語', '英語・スペイン語・日本語・ドイツ語・フランス語（Chrome 149 以降）'],
    ],
    checkHeading: 'モデルの状態を確認する',
    check: 'Chrome のアドレスバーに次のアドレスを入力すると、モデルの状態を確認できます。ウェブページからはこのリンクを開けないため、コピーして貼り付けてください。',
    troubleHeading: '使えないと表示されたら',
    trouble: [
      '空き容量、GPU / RAM、回線、Chrome のバージョンを、上の表と見比べる。',
      'Chrome を最新版に更新して、再起動する。',
      '上の状態確認ページで、モデルの状態を確認する。',
    ],
  },
  usage: [
    {
      heading: '会話する',
      items: [
        '入力欄にメッセージを書いて、Enter で送信します（Shift+Enter で改行）。',
        '生成中は、右下の停止ボタンで止められます。返答の下のボタンで、コピーと再生成ができます。',
        '入力欄の上の「コンテキスト」は、この会話がモデルの記憶容量をどれだけ使っているかの目安です。いっぱいになる前に、古い発言は自動で要約されます。',
      ],
    },
    { heading: '画像を添付する', body: '対応している環境では、入力欄の画像ボタンから画像を添付できます（10MB まで）。画像も端末の外には出ません。' },
    { heading: '複数案で比較する', body: '入力欄の左のボタンから、同じ入力を複数回生成して並べて比べられます。気に入った案は、会話に追加できます。過去の複数案も残ります。' },
    { heading: '一時チャット', body: 'サイドバーの「一時チャット」は、履歴に保存されません。人に見せたくない下書きなどに使えます。' },
    {
      id: 'history',
      heading: '履歴はどこに、どう保存される？',
      body: '履歴はサーバーではなく、このブラウザの中（IndexedDB という保存領域）にだけ保存されます。アカウントも同期もありません。',
      facts: [
        ['いつ保存される', '返事の生成が終わるたびに、自動で保存されます（生成の途中では保存しません）。'],
        ['何が保存される', '会話の本文、添付した画像、複数案の比較結果、ピン留めと名前の変更。'],
        ['保存されないもの', '「一時チャット」の内容。モデル本体は Chrome が別に管理しています。'],
        ['どこに', 'このブラウザ、このプロファイル、このサイトのアドレスの中だけ。別のブラウザ・端末・プロファイルや、別のアドレスからは見えません。'],
        ['暗号化', 'していません。同じブラウザのプロファイルを使う人は、開発者ツールなどで中身を見られます。見られたくない内容は「一時チャット」を使ってください。'],
        ['消えるとき', 'ブラウザの「サイトデータの削除」をしたとき、「全履歴を削除」を押したとき、シークレットウィンドウを閉じたとき。'],
        ['複数のタブ', '別のタブでの変更も、自動で反映されます。'],
      ],
    },
    {
      heading: '履歴を管理する',
      items: [
        '検索: サイドバー上部の検索欄で、タイトルと本文、複数案の中身まで探せます。',
        'ピン留め・名前の変更: 各チャットの「…」メニューから。ピン留めしたチャットは、一覧の上に固定されます。',
        '削除: 「…」メニューからチャットを削除できます。削除した直後は、画面下の「元に戻す」で取り消せます。「選択」から、複数のチャットをまとめて削除することもできます。',
        '全履歴を削除: サイドバーの下にある「全履歴を削除」で、すべての履歴を消せます（確認が出ます）。',
      ],
    },
    {
      heading: 'バックアップと引っ越し',
      items: [
        '書き出し: サイドバー下の「書き出し」で、すべての履歴を 1 つの JSON ファイルに保存できます（画像と複数案も含みます）。各チャットの「…」メニューからは、そのチャットだけを Markdown で保存できます。',
        '読み込み: 「読み込み」で、書き出した JSON を戻せます。同じチャットがすでにあるときは、「マージ」（足りない部分だけ追加）か「別名で保存」（コピーとして追加）を選べます。',
        '端末を変えるとき、ブラウザを入れ替えるときは、書き出して、新しい環境で読み込んでください。',
        '大切な会話は、ときどき書き出しておくと安心です。「サイトデータの削除」では、履歴もバックアップなしには戻りません。',
      ],
    },
    {
      heading: '容量がいっぱいになったら',
      body: 'サイドバー下の「使用」の表示で、使用量を確認できます。上限に近づいたり、書き込めなくなったりしたときは、先に「書き出し」でバックアップしてから、古いチャットを削除してください。',
    },
    { heading: 'オフラインで使う', body: 'モデルのダウンロード後は、機内モードでも動きます。Chrome の「インストール」から、アプリとして使うこともできます。' },
    { heading: '送信されないことを確かめる', body: 'ヘッダーの「オンデバイス · オフライン可 · 送信 0」を押すと、確かめ方の手順が開きます。' },
  ],
}

const en: GuideContent = {
  open: 'Guide',
  title: 'How to use Hitorigoto',
  tabs: ['Welcome', 'First-time setup', 'Using the app'],
  back: 'Back',
  next: 'Next',
  start: 'Get started',
  closeHint: 'You can reopen this guide any time from “Guide” in the header.',
  about: [
    {
      heading: 'What is Hitorigoto?',
      body: 'A chat app with no server that runs only on the on-device AI built into Chrome (Gemini Nano). The only thing you talk to is the model on your machine. The name “hitorigoto” means talking to yourself: your input never leaves your device.',
    },
    {
      heading: 'Your input and history never leave your device',
      body: 'Everything you type, your history and any images you attach are processed and stored only inside this browser. No account, no usage fees, and it works offline once the model is downloaded. Click “0 sent” in the header to verify for yourself that nothing is sent.',
    },
    {
      heading: 'What it is good and bad at',
      items: [
        'Good at: short tasks such as rewriting, summarizing, classifying and brainstorming.',
        'Not good at: long reasoning, recalling exact facts, recent information. Always check the answers yourself.',
      ],
    },
  ],
  setup: {
    intro: 'To use this app, Chrome’s on-device model has to be ready. You only need to do this once; after that it just works.',
    statusLabel: 'Current status',
    status: {
      loading: 'Checking…',
      available: 'The model is ready. Press “Get started” to start chatting.',
      downloadable: 'The model needs to be downloaded. Close this guide and press the “Download model” button on the screen.',
      downloading: 'The model is downloading. Please keep this page open until it finishes.',
      unavailable: 'The model may not work on this device. Check the requirements below.',
      'no-api': 'The Prompt API was not found in this Chrome. Update to desktop Chrome 148 or later.',
    },
    stepsHeading: 'First-time steps',
    steps: [
      { title: 'Use desktop Chrome', body: 'Chrome 148 or later (Windows 10/11, macOS 13+, Linux, Chromebook Plus). Android and iOS are not supported.' },
      { title: 'Check the requirements', body: 'Free storage, a GPU or enough memory, and the connection type must meet the conditions in the table below.' },
      { title: 'Download the model', body: 'Press the “Download model” button shown on the screen. Starting the download requires this button press. It is several GB, so an unmetered connection is recommended. Keep the page open until it finishes.' },
      { title: 'Start chatting', body: 'When the download ends, the chat screen appears automatically. From then on it works without a network.' },
    ],
    requirementsHeading: 'Requirements',
    requirements: [
      ['Supported OS', 'Windows 10/11, macOS 13+, Linux, Chromebook Plus'],
      ['Free storage', '22 GB or more on the drive holding your Chrome profile. The model is removed if free space drops below 10 GB after the download.'],
      ['GPU', 'More than 4 GB of VRAM'],
      ['No GPU', '16 GB of RAM or more, and 4 or more cores'],
      ['Connection', 'An unmetered connection (a connection is needed only for the first download)'],
      ['Languages', 'English, Spanish, Japanese, German and French (Chrome 149 or later)'],
    ],
    checkHeading: 'Check the model’s status',
    check: 'Type the address below into Chrome’s address bar to see the model’s status. Web pages cannot link to it, so copy and paste it.',
    troubleHeading: 'If it says it cannot be used',
    trouble: [
      'Compare your free storage, GPU / RAM, connection and Chrome version with the table above.',
      'Update Chrome to the latest version and restart it.',
      'Check the model’s status on the page above.',
    ],
  },
  usage: [
    {
      heading: 'Chatting',
      items: [
        'Type a message and press Enter to send (Shift+Enter for a new line).',
        'While it is generating, the button at the bottom right stops it. The buttons under a reply copy it or regenerate it.',
        '“Context” above the input is a rough measure of how much of the model’s memory this chat uses. Older messages are summarized automatically before it fills up.',
      ],
    },
    { heading: 'Attaching an image', body: 'Where supported, the image button next to the input attaches an image (up to 10 MB). Images never leave your device either.' },
    { heading: 'Comparing drafts', body: 'The button at the left of the input generates the same input several times and shows the results side by side. You can add a draft you like to the chat. Earlier comparisons are kept.' },
    { heading: 'Temporary chat', body: '“Temporary chat” in the sidebar is not saved to history. Use it for drafts you do not want to keep.' },
    {
      id: 'history',
      heading: 'Where and how is history stored?',
      body: 'History is not kept on a server: it is stored only inside this browser (in a storage area called IndexedDB). There is no account and no sync.',
      facts: [
        ['When it is saved', 'Automatically each time a reply finishes generating (not while it is still being written).'],
        ['What is saved', 'Message text, attached images, draft comparisons, and pins and renames.'],
        ['What is not saved', 'The contents of a “Temporary chat”. The model itself is managed by Chrome separately.'],
        ['Where', 'Only in this browser, this profile and this site address. It is not visible from another browser, device, profile or address.'],
        ['Encryption', 'None. Anyone who can use this browser profile could read it with developer tools. For anything you do not want kept, use a “Temporary chat”.'],
        ['When it disappears', 'When you clear the browser’s site data, press “Delete all history”, or close a private (incognito) window.'],
        ['Multiple tabs', 'Changes made in another tab show up automatically.'],
      ],
    },
    {
      heading: 'Managing history',
      items: [
        'Search: the search box at the top of the sidebar finds titles, message text and even draft comparisons.',
        'Pin and rename: use the “…” menu on each chat. Pinned chats stay at the top of the list.',
        'Delete: the “…” menu deletes a chat. Right after deleting, “Undo” at the bottom of the screen restores it. “Select” lets you delete several chats at once.',
        'Delete all history: the button at the bottom of the sidebar erases everything (with a confirmation).',
      ],
    },
    {
      heading: 'Backup and moving',
      items: [
        'Export: “Export” at the bottom of the sidebar saves all history to one JSON file (images and drafts included). The “…” menu of a chat saves just that chat as Markdown.',
        'Import: “Import” restores an exported JSON file. If a chat already exists you can choose “Merge” (add only what is missing) or “Save as copy” (add it as a copy).',
        'When you change device or browser, export here and import there.',
        'It is a good idea to export important conversations from time to time. Clearing site data cannot be undone without a backup.',
      ],
    },
    {
      heading: 'When storage fills up',
      body: 'The “Used” line at the bottom of the sidebar shows how much is used. When it gets close to the limit, or writing fails, export a backup first and then delete old chats.',
    },
    { heading: 'Using it offline', body: 'Once the model is downloaded it works in airplane mode. You can also “Install” it from Chrome and use it like an app.' },
    { heading: 'Verifying that nothing is sent', body: 'Click “On-device · Works offline · 0 sent” in the header to open the steps for checking it yourself.' },
  ],
}

export const guideContent: Record<Lang, GuideContent> = { ja, en }

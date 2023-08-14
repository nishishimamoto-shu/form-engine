require('dotenv').config();

// 必要なモジュールのインポート
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { Configuration, OpenAIApi } = require("openai");
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// 対象のURLの定義
const url = 'https://sales-bank.com/contact/';

// メインの非同期関数の定義
async function run() {
    // ブラウザとページの設定
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    // リクエストの監視設定
    await page.setRequestInterception(true);
    page.on('request', (req) => {
         // Google Analyticsと画像、スタイルシート、フォントのリクエストを中止
        if (req.url().includes('www.google-analytics.com')) {
            req.abort();
        } else if (['image', 'stylesheet', 'font'].indexOf(req.resourceType()) !== -1) {
            req.abort();
        } else {
            req.continue();
        }
    });
    // ページへの移動と要素のクリック
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });
    const result = await processOnInput(page);
    console.log(result); // 出力結果をログに表示

    async function processOnInput(page) {
        try {
            // チェックボックスと同意ボタンのクリック処理
            const [checkbox] = await page.$x("//input[@type='checkbox']");
            if (checkbox) {
                await checkbox.click();
            }
            const [button] = await page.$x("//input[contains(@value, '同意') or @type='image'] | //a[contains(text(), '同意')] | //span[contains(text(), '同意')]");
            if (button) {
                const navigationPromise = page.waitForNavigation({timeout: 10000});
                await button.click();
                await navigationPromise;
            }
        } catch (error) {
            console.log('No agreement button found');
        }
        // formタグを抽出
        const html = await page.content();
        let $ = cheerio.load(html);
        let formsHTML = [];
        $('form').each(function() {
            if ($(this).find('input').length > 1) {
                if ($(this).find('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
                    formsHTML.push($(this).html());
                }
            }
        });
        // formタグが見つからない場合、iframe内のformタグを抽出
        if (formsHTML.length === 0) {
            const iframes = await page.$$('iframe');
            for (let iframe of iframes) {
                try {
                    const frame = await iframe.contentFrame();
                    await frame.waitForSelector('form', { timeout: 5000 });

                    const iframeHTML = await frame.content();
                    const $iframe = cheerio.load(iframeHTML);
                    $iframe('form').each(function() {
                        if ($iframe(this).find('input').length > 1) {
                            formsHTML.push($iframe(this).html());
                        }
                    });
                } catch (error) {
                    console.log('No form found in this iframe. Error:', error);
                }
            }
        }
        // 複数HTMLが取得されている場合は長いHTMLを優先
        let longestFormHTML = formsHTML.reduce((a, b) => a.length > b.length ? a : b, "");
        // 最後にformが見つかっていない場合は生のHTMLを取得しform-form部分を抜き出す
        if (longestFormHTML .length === 0) {
            console.log("No form found in the initial HTML. Trying to fetch raw HTML...");
            await page.setRequestInterception(true);
            let responseProcessingPromise = null;
            page.on('response', async (response) => {
                if (response.url() === url && response.request().resourceType() === 'document') {
                    responseProcessingPromise = (async () => {
                        const source_website_html_content = await response.text();
                        const startIndex = source_website_html_content.indexOf('form');
                        const endIndex = source_website_html_content.lastIndexOf('form') + 'form'.length;
                        const formHTML = source_website_html_content.slice(startIndex, endIndex);
                        const $ = cheerio.load(formHTML);
                        if ($('input').length > 1 &&
                        $('input[type="search"], input[name="q"], input[placeholder="検索"]').length === 0) {
                            return formHTML;
                        } else {
                            return "";
                        }
                    })();
                }
            });
            await page.goto(url);
            await page.setRequestInterception(true);
            if (responseProcessingPromise) {
                longestFormHTML = await responseProcessingPromise; // 戻り値をlongestFormHTMLに代入
            }
        }
        if (longestFormHTML.length === 0) {
            console.log("No form found. Exiting...");
            
        } else {
            $ = cheerio.load(longestFormHTML);
            const fields = [];
                // フィールドの解析関数
            const parseField = (el, type) => {
                const name = $(el).attr('name') || $(el).attr('id') || $(el).attr('class');
                const value = name; // value変数にnameの値を割り当てる
                const field = { name: value, value: name, type: type };
                console.log("Parsed Field:", field); // ここで解析結果をログ出力
                fields.push({ name: value, value: name, type: type });
            };
        
            // text, email, textareaなどのフィールドを解析
            $('input[type="text"], input[type="email"], input[type="date"], input[type="month"], input[type="number"], input[type="tel"], input[type="time"], input[type="url"], input[type="week"], textarea').each(function() {
                parseField(this, $(this).attr('type') || 'textarea');
            });
        
            // radioやselectなどのフィールドを解析
            $('input[type="radio"], input[type="checkbox"]').each(function() {
                const type = $(this).attr('type');
                const selectedValue = $(this).attr('value');
                parseField(this, type);
                fields[fields.length - 1].selectedValue = selectedValue; // 最後に追加したフィールドに選択値を追加
            });

            // selectフィールドの解析
            $('select').each(function() {
                const type = 'select';
                const selectedValue = $(this).find('option:selected').val();
                parseField(this, type);
                fields[fields.length - 1].selectedValue = selectedValue; // 最後に追加したフィールドに選択値を追加
            });

            // optionフィールドの解析（特定のケースで必要な場合）
            $('option').each(function() {
                const type = 'option';
                const selectedValue = $(this).attr('value');
                parseField(this, type);
                fields[fields.length - 1].selectedValue = selectedValue; // 最後に追加したフィールドに選択値を追加
            });
        
            // 送信ボタンのセレクタを探す
            const submit = $('button[type="submit"], input[type="submit"]').attr('name') || 'button[type="submit"]';

            const dataToSend = {
                企業名: "営業製作所株式会社",
                担当者名: "安田　美佳",
                ふりがな担当者名: "やすだ　みか",
                漢字性:"安田",
                漢字名:"美佳",
                ふりがな性: "やすだ",
                ふりがな名: "みか",
                メール: "m.yasuda@sales-bank.com",
                電話: "06-6136-8027",
                郵便番号: "550-0002",
                住所: "大阪府大阪市西区江戸堀1-22-38　三洋ビル501",
                生年月日:"1992年4月14日",
                返信方法: "メール",
                問い合わせ分類: "サービスについて",
                部署:"営業部",
                役職:"主査",
                件名:"【製造業7,000名の担当者から廃材回収のニーズを頂戴しております】",
                問い合わせ内容:
                "代表者様 \nお世話になります。\n営業製作所の安田と申します。\n製造業の担当者7,000名から廃材回収に関するニーズを頂戴しております\n具体的なニーズの有無まで調査行い、ご紹介が可能ですのでご連絡させていただきました。\n弊社は、製造業に特化した事業を展開しており、 サービスリリース2年で500社の企業様にご活用いただいております。\n貴社の回収しやすい【材質】【大きさ】【形状】【重量】を満たす、取引先を発掘することが可能です。 \n同業他社での実績や貴社に合致したレポートをご用意しておりますので、ご興味をお持ち頂ける場合はお電話にて詳細をお伝えします。\n 下記メールアドレスにお電話可能な日時をお送りくださいませ。\n ■メールアドレス m.yasuda@sales-bank.com \n■弊社パンフレット https://tinyurl.com/239r55dc \nそれではご連絡お待ちしております。"
            };

            async function mapFieldToData(fields, dataToSend) {
                const fieldsJsonString = JSON.stringify({ fields: fields }, null, 2);
                const promptContent = `
                Analyze the following fields and data, and map the field names with the corresponding data. If a field has multiple "selectedValue" options, choose the one that corresponds to the key in the "dataToSend". If a perfect match is not found, choose a default value to ensure submission.

                Fields to analyze:
                ${fieldsJsonString}
                
                Data to analyze:
                ${JSON.stringify(dataToSend, null, 2)}
                
                Provide the analysis result in the following JSON format:
                {
                    "fields": [
                        // For text, email, textarea fields: {"name": "dataToSend's key", "value": "field attribute name", "type": "field's type"}
                        // For radio, select fields: {"name": "dataToSend's key", "value": "field attribute name", "type": "field's type", "selectedValue": "chosen value"}
                    ],
                    "submit": "submit button's selector" // e.g., button[name="submitName"]
                }
                
                Map all text, email, textarea fields accurately.
                For radio or checkbox or select, specify the selected value based on the given information.
                Identify the submit button's selector precisely.
                Inquiry content is likely to be analyzed as a textarea field.
                Not all content in dataToSend needs to be used.
                `;
                
            
                console.log("Prompt Content:", promptContent);
            
                const completion = await openai.createChatCompletion({
                    model: "gpt-4",
                    messages: [
                        {"role": "system", "content": "You are one of the world's leading engineers, specializing in HTML analysis."},
                        {"role": "user", "content": promptContent}
                    ]
                });            
                const mappedName = completion.data.choices[0].message.content;
                console.log("Mapped Name:", mappedName); 
                return mappedName;

            }
            async function processFields(fields, dataToSend) {
                const mappedData = await mapFieldToData(fields, dataToSend); // 全フィールドの対応情報を取得
                mappedData.fields.forEach((field, index) => {
                  fields[index].value = field.value; // フィールドのvalueを更新
                });
                return { fields: fields, submit: mappedData.submit };
            }
              
            const updatedFields = await processFields({ fields: fields, submit: submit }, dataToSend);
            console.log(updatedFields);
            
            return {
                fields: fields,
                submit: submit
            };
        }
    }
}

run().catch(error => console.error(error));

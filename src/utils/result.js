const {
  saveSubmission,
  saveForm,
  generateFormsDocumentId,
} = require('../services/firestore');
const {
  getSymbol,
  getRowNumberForUrl,
  updateSpreadsheet,
} = require('../services/spreadsheet');
const {TimeManager} = require('./time');
const INPUT_RESULT_COMPLETE = 'COMPLETE';
const INPUT_RESULT_ERROR = 'ERROR';
const INPUT_RESULT_NONE = 'NONE';
const INPUT_RESULT_FORM_NOT_FOUND = 'FORM_NOT_FOUND';
const RESULT_SUCCESS = 'SUCCESS';
const RESULT_ERROR = 'ERROR';

/**
 * Firestoreに結果を保存する
 * @param {string} url
 * @param {object} formData
 * @param {object} submissionData
 * @return {Promise<void>}
 */
async function saveResultToFirestore(url, formData, submissionData) {
  const docId = generateFormsDocumentId(url);
  await saveForm(docId, formData);
  await saveSubmission({
    ...submissionData,
    formId: docId,
  });
}

/**
 * スプレッドシートに結果を保存する
 * @param {string} url
 * @param {string} result
 * @return {Promise<void>}
 */
async function saveResultToSpreadsheet(url, result) {
  try {
    const rowNumber = await getRowNumberForUrl(url); // URLに対応する行番号を取得
    if (rowNumber === null) return; // 行が見つからない場合、処理を終了

    const symbol = getSymbol(result); // 結果を記号に直す
    const date = TimeManager.getInstance().getLocaleString();
    const range = `Sheet1!E${rowNumber}:F${rowNumber}`; // E列とF列の対応する行を指定
    const values = [[symbol, date]];
    await updateSpreadsheet(range, values);
  } catch (e) {
    console.error('Error while updating spreadsheet', e);
  }
}

module.exports = {
  INPUT_RESULT_COMPLETE,
  INPUT_RESULT_ERROR,
  INPUT_RESULT_NONE,
  INPUT_RESULT_FORM_NOT_FOUND,
  RESULT_SUCCESS,
  RESULT_ERROR,
  saveResultToFirestore,
  saveResultToSpreadsheet,
};

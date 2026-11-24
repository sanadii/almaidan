import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAnswerText } from '../src/utils/answer-text';

const BS = String.fromCharCode(92);
const wrapped = (text: string) => `${BS}|${BS}|${text}${BS}|${BS}`;

test('escaped spoiler markers are removed from saved-source answers', () => {
  assert.equal(cleanAnswerText(wrapped('باريس')), 'باريس');
  assert.equal(cleanAnswerText(wrapped('كريم بنزيما')), 'كريم بنزيما');
  assert.equal(cleanAnswerText(`${BS}|${BS}|القوس A${BS}*${BS}|${BS}`), 'القوس A*');
  assert.equal(cleanAnswerText('||مضيق بيرينغ||'), 'مضيق بيرينغ');
});

test('ordinary answers and inner separators are preserved; markers alone are never emptied', () => {
  assert.equal(cleanAnswerText('باريس'), 'باريس');
  assert.equal(cleanAnswerText('أ|ب'), 'أ|ب');
  assert.equal(cleanAnswerText(' القاهرة '), 'القاهرة');
  assert.equal(cleanAnswerText(`${BS}|${BS}|`), `${BS}|${BS}|`);
});

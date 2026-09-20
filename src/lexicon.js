// lexicon.js — the tiny offline language model behind word prediction.
// Frequencies are hand-tuned toward everyday needs-based communication
// (AAC), not general web text: words like "help", "please", "pain",
// "water" rank higher than they would in a news corpus.

// Unigram -> weight. Higher = suggested sooner during word completion.
export const UNIGRAMS = {
  i: 100, you: 82, the: 80, to: 78, a: 74, and: 70, is: 66, it: 64,
  please: 63, help: 62, need: 60, want: 58, yes: 57, no: 56, thank: 55,
  thanks: 40, me: 54, my: 52, can: 50, could: 40, would: 38, do: 48,
  are: 46, not: 45, now: 44, later: 30, water: 43, food: 42, hungry: 30,
  thirsty: 29, tired: 34, pain: 41, hurt: 33, cold: 32, hot: 31, ok: 39,
  okay: 28, good: 37, bad: 27, feel: 36, feeling: 26, better: 25, worse: 20,
  go: 35, come: 34, here: 33, there: 24, bathroom: 32, bed: 31, sit: 23,
  up: 30, down: 29, stop: 38, wait: 37, more: 36, less: 19, again: 22,
  call: 35, doctor: 34, nurse: 33, family: 22, home: 32, phone: 31,
  light: 21, tv: 20, music: 21, book: 20, read: 19, warm: 18, blanket: 24,
  love: 26, happy: 25, sad: 18, scared: 20, fine: 27, sorry: 24, hello: 30,
  goodbye: 18, morning: 20, night: 21, today: 22, tomorrow: 17, minute: 16,
  what: 30, where: 28, when: 26, who: 22, why: 20, how: 24, this: 34,
  that: 32, right: 25, left: 24, on: 33, off: 30, open: 26, close: 24,
  turn: 25, get: 34, give: 28, take: 27, see: 26, know: 30, think: 24,
  am: 40, being: 12, very: 22, really: 20, much: 21, too: 22, so: 28,
  we: 30, they: 24, she: 22, he: 22, them: 16, us: 18, your: 30, our: 20,
};

// Bigram rows: previous word -> most-likely next words (most frequent first).
export const BIGRAMS = {
  i: ['need', 'want', 'am', 'feel', 'would', 'love', 'think', 'can'],
  need: ['help', 'to', 'water', 'the', 'my', 'a', 'more', 'you'],
  want: ['to', 'water', 'help', 'my', 'the', 'food', 'a', 'more'],
  to: ['go', 'the', 'bed', 'help', 'eat', 'drink', 'sit', 'call'],
  please: ['help', 'wait', 'come', 'call', 'stop', 'give', 'turn', 'get'],
  help: ['me', 'please', 'now', 'with'],
  can: ['you', 'i', 'we', 'help'],
  could: ['you', 'i', 'we', 'please'],
  you: ['please', 'help', 'are', 'can', 'for', 'come', 'get'],
  am: ['tired', 'hungry', 'thirsty', 'in', 'fine', 'ok', 'cold', 'hot'],
  feel: ['tired', 'better', 'worse', 'cold', 'hot', 'sick', 'good', 'bad'],
  feeling: ['tired', 'better', 'worse', 'cold', 'sick', 'good'],
  in: ['pain', 'bed', 'the'],
  the: ['bathroom', 'doctor', 'nurse', 'light', 'tv', 'phone', 'bed', 'door'],
  my: ['head', 'back', 'family', 'phone', 'bed', 'legs', 'hands'],
  call: ['the', 'my', 'a', 'you'],
  turn: ['on', 'off', 'the', 'up', 'down'],
  go: ['to', 'home', 'now', 'there'],
  thank: ['you'],
  is: ['it', 'that', 'this', 'there'],
  it: ['is', 'hurts', 'now'],
  more: ['water', 'food', 'please', 'time'],
  yes: ['please', 'thank'],
  no: ['thank', 'thanks', 'not'],
};

// Sentence starters shown when the buffer is empty.
export const STARTERS = ['I', 'Please', 'Yes', 'No', 'Can', 'Thank', 'Help', 'Hello'];

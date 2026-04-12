const { calculatePoints, checkAnswer, shuffle } = require('../src/services/roomService');

describe('calculatePoints', () => {
  test('returns 2 points when answered in under 5 seconds', () => {
    expect(calculatePoints(0)).toBe(2);
    expect(calculatePoints(2.5)).toBe(2);
    expect(calculatePoints(4.99)).toBe(2);
  });

  test('returns 1.75 points when answered in 5-10 seconds', () => {
    expect(calculatePoints(5)).toBe(1.75);
    expect(calculatePoints(7)).toBe(1.75);
    expect(calculatePoints(9.99)).toBe(1.75);
  });

  test('returns 1.5 points when answered in 10-15 seconds', () => {
    expect(calculatePoints(10)).toBe(1.5);
    expect(calculatePoints(12)).toBe(1.5);
    expect(calculatePoints(15)).toBe(1.5);
  });

  test('returns 0 points when answered after 15 seconds', () => {
    expect(calculatePoints(15.01)).toBe(0);
    expect(calculatePoints(30)).toBe(0);
    expect(calculatePoints(120)).toBe(0);
  });
});

describe('checkAnswer', () => {
  describe('multiple choice', () => {
    const q = { type: 'multiple', options: ['A', 'B', 'C', 'D'], correct: [1] };

    test('correct answer', () => {
      expect(checkAnswer(q, { option: 1 })).toBe(true);
    });

    test('wrong answer', () => {
      expect(checkAnswer(q, { option: 0 })).toBe(false);
      expect(checkAnswer(q, { option: 3 })).toBe(false);
    });
  });

  describe('true/false', () => {
    const q = { type: 'truefalse', options: ['True', 'False'], correct: [0] };

    test('correct answer', () => {
      expect(checkAnswer(q, { option: 0 })).toBe(true);
    });

    test('wrong answer', () => {
      expect(checkAnswer(q, { option: 1 })).toBe(false);
    });
  });

  describe('multi_select', () => {
    const q = { type: 'multi_select', options: ['A', 'B', 'C', 'D'], correct: [0, 2] };

    test('correct answers (same order)', () => {
      expect(checkAnswer(q, { options: [0, 2] })).toBe(true);
    });

    test('correct answers (different order)', () => {
      expect(checkAnswer(q, { options: [2, 0] })).toBe(true);
    });

    test('wrong - missing one', () => {
      expect(checkAnswer(q, { options: [0] })).toBe(false);
    });

    test('wrong - extra selection', () => {
      expect(checkAnswer(q, { options: [0, 1, 2] })).toBe(false);
    });

    test('wrong - completely wrong', () => {
      expect(checkAnswer(q, { options: [1, 3] })).toBe(false);
    });

    test('handles missing options field', () => {
      expect(checkAnswer(q, {})).toBe(false);
    });
  });

  describe('text', () => {
    const q = { type: 'text', options: [], correct: ['Paris', 'paris'] };

    test('exact match', () => {
      expect(checkAnswer(q, { text: 'Paris' })).toBe(true);
    });

    test('case insensitive', () => {
      expect(checkAnswer(q, { text: 'PARIS' })).toBe(true);
      expect(checkAnswer(q, { text: 'pArIs' })).toBe(true);
    });

    test('with whitespace trimming', () => {
      expect(checkAnswer(q, { text: '  Paris  ' })).toBe(true);
    });

    test('wrong answer', () => {
      expect(checkAnswer(q, { text: 'London' })).toBe(false);
    });

    test('empty answer', () => {
      expect(checkAnswer(q, { text: '' })).toBe(false);
      expect(checkAnswer(q, {})).toBe(false);
    });
  });

  describe('unknown type', () => {
    test('returns false for unsupported question type', () => {
      const q = { type: 'unknown', correct: [0] };
      expect(checkAnswer(q, { option: 0 })).toBe(false);
    });
  });
});

describe('shuffle', () => {
  test('returns array of same length', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle([...arr]);
    expect(result).toHaveLength(5);
  });

  test('contains same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = shuffle([...arr]);
    expect(result.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test('mutates in place and returns same reference', () => {
    const arr = [1, 2, 3];
    const result = shuffle(arr);
    expect(result).toBe(arr);
  });

  test('handles empty array', () => {
    expect(shuffle([])).toEqual([]);
  });

  test('handles single element', () => {
    expect(shuffle([42])).toEqual([42]);
  });
});

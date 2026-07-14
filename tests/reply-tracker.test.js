import { describe, it, expect } from 'vitest';
import { groupCompanies } from '../scripts/reply-tracker.js';

describe('Reply Tracker logic tests', () => {
  it('groups multiple applications to the same company correctly', () => {
    // Mock row format: [ , , , company, , , , , , , status ]
    const mockRows = [
      ['Date', 'ID', 'Title', 'Google', '', '', '', '', '', '', 'APPLIED'],
      ['Date', 'ID', 'Title', 'Facebook', '', '', '', '', '', '', 'APPLIED'],
      ['Date', 'ID', 'Title', 'Google', '', '', '', '', '', '', 'APPLIED'],
      ['Date', 'ID', 'Title', 'Amazon', '', '', '', '', '', '', 'REPLIED'], // Should be ignored
    ];

    const { pendingRows, lowerCompanies } = groupCompanies(mockRows);

    // Google appears at index 0 and 2.
    expect(lowerCompanies.get('google')).toEqual([0, 2]);
    
    // Facebook appears at index 1.
    expect(lowerCompanies.get('facebook')).toEqual([1]);
    
    // Amazon is not 'APPLIED' so it shouldn't be in the map
    expect(lowerCompanies.has('amazon')).toBe(false);
  });
});

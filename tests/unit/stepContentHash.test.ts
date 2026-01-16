import {
  normalizeWhitespace,
  computeStepContentHash,
  computeStepHash,
  isStepContentUnchanged,
  setStepContentHash,
  HashableStep,
} from '../../server/src/utils/stepContentHash';

describe('stepContentHash utility', () => {
  describe('normalizeWhitespace', () => {
    it('should return empty string for null/undefined/empty input', () => {
      expect(normalizeWhitespace('')).toBe('');
      expect(normalizeWhitespace(null as unknown as string)).toBe('');
      expect(normalizeWhitespace(undefined as unknown as string)).toBe('');
    });

    it('should trim leading and trailing whitespace', () => {
      expect(normalizeWhitespace('  hello  ')).toBe('hello');
      expect(normalizeWhitespace('\t\thello\t\t')).toBe('hello');
      expect(normalizeWhitespace('\n\nhello\n\n')).toBe('hello');
    });

    it('should collapse multiple spaces into single space', () => {
      expect(normalizeWhitespace('hello    world')).toBe('hello world');
      expect(normalizeWhitespace('a  b  c  d')).toBe('a b c d');
    });

    it('should collapse multiple tabs into single space', () => {
      expect(normalizeWhitespace('hello\t\t\tworld')).toBe('hello world');
    });

    it('should normalize Windows line endings (CRLF) to LF', () => {
      expect(normalizeWhitespace('hello\r\nworld')).toBe('hello\nworld');
      expect(normalizeWhitespace('a\r\nb\r\nc')).toBe('a\nb\nc');
    });

    it('should normalize old Mac line endings (CR) to LF', () => {
      expect(normalizeWhitespace('hello\rworld')).toBe('hello\nworld');
    });

    it('should collapse multiple newlines into single newline', () => {
      expect(normalizeWhitespace('hello\n\n\nworld')).toBe('hello\nworld');
    });

    it('should handle mixed whitespace', () => {
      // After normalization: collapse spaces, collapse newlines, trim
      // '  hello  \n\n  world  ' -> ' hello \n\n world ' -> ' hello \n world ' -> 'hello \n world'
      expect(normalizeWhitespace('  hello  \n\n  world  ')).toBe('hello \n world');
    });

    it('should preserve single spaces and newlines', () => {
      expect(normalizeWhitespace('hello world')).toBe('hello world');
      expect(normalizeWhitespace('line1\nline2')).toBe('line1\nline2');
    });
  });

  describe('computeStepContentHash', () => {
    it('should compute a 16-character hex hash', () => {
      const hash = computeStepContentHash('Test Title', 'Test Description');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should be deterministic - same input produces same output', () => {
      const hash1 = computeStepContentHash('Title', 'Description');
      const hash2 = computeStepContentHash('Title', 'Description');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different titles', () => {
      const hash1 = computeStepContentHash('Title A', 'Same description');
      const hash2 = computeStepContentHash('Title B', 'Same description');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different descriptions', () => {
      const hash1 = computeStepContentHash('Same title', 'Description A');
      const hash2 = computeStepContentHash('Same title', 'Description B');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty description', () => {
      const hash1 = computeStepContentHash('Title', '');
      const hash2 = computeStepContentHash('Title', null);
      const hash3 = computeStepContentHash('Title', undefined);
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should normalize whitespace for consistent hashing', () => {
      const hash1 = computeStepContentHash('Title', 'Description');
      const hash2 = computeStepContentHash('  Title  ', '  Description  ');
      expect(hash1).toBe(hash2);
    });

    it('should normalize line endings for consistent hashing', () => {
      const hash1 = computeStepContentHash('Title', 'Line1\nLine2');
      const hash2 = computeStepContentHash('Title', 'Line1\r\nLine2');
      const hash3 = computeStepContentHash('Title', 'Line1\rLine2');
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('should collapse multiple whitespace for consistent hashing', () => {
      const hash1 = computeStepContentHash('Title', 'hello world');
      const hash2 = computeStepContentHash('Title', 'hello    world');
      expect(hash1).toBe(hash2);
    });

    it('should distinguish between title/description content', () => {
      // "A|B" should differ from "A|" + "B" in description
      const hash1 = computeStepContentHash('Title|Extra', '');
      const hash2 = computeStepContentHash('Title', 'Extra');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('computeStepHash', () => {
    it('should compute hash from step object', () => {
      const step: HashableStep = {
        title: 'Test Step',
        description: 'Test Description',
      };
      const hash = computeStepHash(step);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should match computeStepContentHash output', () => {
      const step: HashableStep = {
        title: 'Test Step',
        description: 'Test Description',
      };
      const hashFromObject = computeStepHash(step);
      const hashFromValues = computeStepContentHash('Test Step', 'Test Description');
      expect(hashFromObject).toBe(hashFromValues);
    });

    it('should handle step with no description', () => {
      const step: HashableStep = {
        title: 'Test Step',
      };
      const hash = computeStepHash(step);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should handle step with null description', () => {
      const step: HashableStep = {
        title: 'Test Step',
        description: null,
      };
      const hash = computeStepHash(step);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('isStepContentUnchanged', () => {
    it('should return false when step has no contentHash', () => {
      const step = {
        title: 'Test Step',
        description: 'Test Description',
      };
      expect(isStepContentUnchanged(step)).toBe(false);
    });

    it('should return false when contentHash is null', () => {
      const step = {
        title: 'Test Step',
        description: 'Test Description',
        contentHash: null,
      };
      expect(isStepContentUnchanged(step)).toBe(false);
    });

    it('should return true when content matches hash', () => {
      const step = {
        title: 'Test Step',
        description: 'Test Description',
        contentHash: computeStepContentHash('Test Step', 'Test Description'),
      };
      expect(isStepContentUnchanged(step)).toBe(true);
    });

    it('should return false when title changed', () => {
      const originalHash = computeStepContentHash('Original Title', 'Description');
      const step = {
        title: 'Changed Title',
        description: 'Description',
        contentHash: originalHash,
      };
      expect(isStepContentUnchanged(step)).toBe(false);
    });

    it('should return false when description changed', () => {
      const originalHash = computeStepContentHash('Title', 'Original Description');
      const step = {
        title: 'Title',
        description: 'Changed Description',
        contentHash: originalHash,
      };
      expect(isStepContentUnchanged(step)).toBe(false);
    });

    it('should be whitespace-insensitive', () => {
      // Hash computed with extra whitespace
      const originalHash = computeStepContentHash('  Title  ', '  Description  ');
      // Step with normalized whitespace
      const step = {
        title: 'Title',
        description: 'Description',
        contentHash: originalHash,
      };
      expect(isStepContentUnchanged(step)).toBe(true);
    });
  });

  describe('setStepContentHash', () => {
    it('should set contentHash on step object', () => {
      const step = {
        title: 'Test Step',
        description: 'Test Description',
        contentHash: undefined as string | undefined,
      };
      setStepContentHash(step);
      expect(step.contentHash).toBeDefined();
      expect(step.contentHash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should overwrite existing contentHash', () => {
      const step = {
        title: 'Test Step',
        description: 'Test Description',
        contentHash: 'oldhash123456789',
      };
      setStepContentHash(step);
      expect(step.contentHash).not.toBe('oldhash123456789');
    });

    it('should set correct hash for current content', () => {
      const step = {
        title: 'My Title',
        description: 'My Description',
        contentHash: undefined as string | undefined,
      };
      setStepContentHash(step);
      expect(step.contentHash).toBe(computeStepContentHash('My Title', 'My Description'));
    });

    it('should allow isStepContentUnchanged to return true after setting', () => {
      const step = {
        title: 'Test Step',
        description: 'Test Description',
        contentHash: undefined as string | undefined,
      };
      setStepContentHash(step);
      expect(isStepContentUnchanged(step)).toBe(true);
    });
  });

  describe('integration: step modification workflow', () => {
    it('should detect when step content changes after completion', () => {
      // Simulate step completion
      const step = {
        title: 'Original Title',
        description: 'Original Description',
        contentHash: undefined as string | undefined,
      };
      setStepContentHash(step);

      // Content unchanged - should skip
      expect(isStepContentUnchanged(step)).toBe(true);

      // Now modify the step content (during Stage 2 revision)
      step.title = 'Modified Title';

      // Content changed - should re-implement
      expect(isStepContentUnchanged(step)).toBe(false);
    });

    it('should handle description-only changes', () => {
      const step = {
        title: 'Same Title',
        description: 'Original Description',
        contentHash: undefined as string | undefined,
      };
      setStepContentHash(step);
      expect(isStepContentUnchanged(step)).toBe(true);

      // Modify only description
      step.description = 'Modified Description';
      expect(isStepContentUnchanged(step)).toBe(false);
    });

    it('should not trigger re-implementation for whitespace-only changes', () => {
      const step = {
        title: 'Title',
        description: 'Description',
        contentHash: undefined as string | undefined,
      };
      setStepContentHash(step);
      expect(isStepContentUnchanged(step)).toBe(true);

      // Add insignificant whitespace
      step.title = '  Title  ';
      step.description = '  Description  ';

      // Should still be considered unchanged
      expect(isStepContentUnchanged(step)).toBe(true);
    });

    it('should handle clearing contentHash to force re-implementation', () => {
      const step = {
        title: 'Title',
        description: 'Description',
        contentHash: undefined as string | undefined | null,
      };
      setStepContentHash(step);
      expect(isStepContentUnchanged(step)).toBe(true);

      // Clear hash to force re-implementation (as done when step is edited)
      step.contentHash = undefined;
      expect(isStepContentUnchanged(step)).toBe(false);

      // Or set to null
      step.contentHash = null;
      expect(isStepContentUnchanged(step)).toBe(false);
    });
  });

  describe('hash algorithm properties', () => {
    it('should use SHA256 (produces consistent length output)', () => {
      // SHA256 produces 64 hex chars, we take first 16
      const hash = computeStepContentHash('test', 'test');
      expect(hash.length).toBe(16);
    });

    it('should be collision-resistant for similar inputs', () => {
      const hashes = new Set<string>();
      const testCases = [
        ['Title', 'Description'],
        ['Title ', 'Description'],
        ['Title', ' Description'],
        ['Title1', 'Description'],
        ['Title', 'Description1'],
        ['Titl', 'eDescription'],
        ['T', 'itleDescription'],
      ];

      for (const [title, desc] of testCases) {
        hashes.add(computeStepContentHash(title, desc));
      }

      // After whitespace normalization, 'Title ' and 'Title' become same
      // So we expect fewer unique hashes than test cases
      expect(hashes.size).toBeGreaterThanOrEqual(5);
    });
  });
});

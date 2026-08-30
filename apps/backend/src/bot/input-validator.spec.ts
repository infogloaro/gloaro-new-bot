import { formatPhone, normalisePhone, validateField } from './input-validator';

describe('normalisePhone', () => {
  it.each([
    ['9876543210', '919876543210'],
    ['09876543210', '919876543210'],
    ['919876543210', '919876543210'],
    ['+91 98765 43210', '919876543210'],
    ['+91-98765-43210', '919876543210'],
    ['91 98765 43210', '919876543210'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each(['12345', 'abcdefghij', '', '123456789'])('rejects %s', (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  it('rejects Indian numbers that do not start 6-9', () => {
    expect(normalisePhone('1234567890')).toBe('1234567890'); // kept as international
    expect(normalisePhone('5876543210')).toBe('5876543210');
  });

  it('formats a stored number for display', () => {
    expect(formatPhone('919876543210')).toBe('+91 98765 43210');
  });
});

describe('validateField', () => {
  describe('name', () => {
    it('accepts normal names', () => {
      expect(validateField('name', 'Priya Sharma')).toMatchObject({ valid: true, value: 'Priya Sharma' });
      expect(validateField('name', "D'Souza")).toMatchObject({ valid: true });
      expect(validateField('name', 'Ram-Kumar')).toMatchObject({ valid: true });
    });

    it('collapses extra whitespace', () => {
      expect(validateField('name', '  Anil   Menon  ')).toMatchObject({ value: 'Anil Menon' });
    });

    it('rejects single characters and digits', () => {
      expect(validateField('name', 'x').valid).toBe(false);
      expect(validateField('name', '12345').valid).toBe(false);
      expect(validateField('name', '').valid).toBe(false);
    });
  });

  describe('email', () => {
    it('accepts and lowercases valid addresses', () => {
      expect(validateField('email', 'Priya@Sharma.IN')).toMatchObject({
        valid: true,
        value: 'priya@sharma.in',
      });
    });

    it.each(['not-an-email', 'a@b', 'a b@c.com', '@nope.com'])('rejects %s', (input) => {
      expect(validateField('email', input).valid).toBe(false);
    });
  });

  describe('city', () => {
    it('accepts a city name or a 6-digit PIN code', () => {
      expect(validateField('city', 'Coimbatore')).toMatchObject({ valid: true });
      expect(validateField('city', '600001')).toMatchObject({ valid: true, value: '600001' });
    });

    it('rejects a 5-digit number', () => {
      expect(validateField('city', '60000').valid).toBe(false);
    });
  });

  describe('orderid', () => {
    it('accepts and upper-cases an order id', () => {
      expect(validateField('orderid', 'glo-2026-8891')).toMatchObject({
        valid: true,
        value: 'GLO-2026-8891',
      });
    });

    it('rejects an id that is too short', () => {
      expect(validateField('orderid', 'ab').valid).toBe(false);
    });
  });

  describe('longtext', () => {
    it('accepts a requirement', () => {
      expect(validateField('longtext', 'Need 500 LED panels monthly').valid).toBe(true);
    });

    it('rejects an over-long message', () => {
      expect(validateField('longtext', 'x'.repeat(2001)).valid).toBe(false);
    });
  });

  it('returns a customer-facing error message on failure', () => {
    const result = validateField('phone', '12345');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/10-digit mobile number/);
  });
});

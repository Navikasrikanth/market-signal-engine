/**
 * A small dictionary floor, not a security product.
 *
 * Length alone lets "password1234" through, and that string is in every
 * cracking wordlist ever assembled. This is deliberately short — the real
 * defences are bcrypt cost 12 and the lockout in `auth.ts`; a full wordlist
 * belongs behind a service like Have I Been Pwned's k-anonymity API, which
 * needs network access this project does not assume.
 *
 * Compared against the password reduced to its letters, so "P@ssw0rd!!" and
 * "passw0rd" collapse to the same entry.
 */
export const COMMON_PASSWORDS = [
  'password',
  'passwort',
  'letmein',
  'welcome',
  'qwerty',
  'qwertyuiop',
  'asdfgh',
  'zxcvbn',
  'iloveyou',
  'admin',
  'administrator',
  'login',
  'abc',
  'abcd',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'superman',
  'batman',
  'trustno',
  'master',
  'shadow',
  'michael',
  'jennifer',
  'jordan',
  'harley',
  'ranger',
  'freedom',
  'whatever',
  'changeme',
  'secret',
  'default',
  'test',
  'testing',
  'demo',
  'guest',
  'root',
  'toor',
  'pass',
  'temp',
  'hunter',
  'starwars',
  'pokemon',
  'computer',
  'internet',
  'sitrep',
  'groww',
] as const

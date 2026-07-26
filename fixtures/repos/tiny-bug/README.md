# Tiny bug fixture

This fixture is used for manual Verified Fix rehearsals.

## Bug

`src/add.js` currently returns the wrong sum.

## Expected

`add(2, 3) === 5`

## Verification

```bash
node --test test/add.test.js
```

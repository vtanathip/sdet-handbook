# Agent Skills Definitions

This file defines the capabilities (skills) available to the Copilot Agent in this workspace.

## Skill: `validateEmail`

**Description**: check if the format of email is correct (`user@domain.com`).
**Triggers**:

- "Check if this email is valid"
- "Add email validation"
**Usage Example**:

```typescript
import { validateEmail } from './utils';
if (!validateEmail(userInput)) {
  throw new Error("Invalid email");
}
```

## Skill: `checkPasswordStrength`

**Description**: Verifies if a password meets security standards (Min 8 chars, 1 Upper, 1 Lower, 1 Number).
**Triggers**:

- "Is this password strong enough?"
- "Secure password check"
**Usage Example**:

```typescript
if (!checkPasswordStrength(password)) {
  showError("Password is too weak");
}
```

## Skill: `generateTestBoilerplate`

**Description**: Creates a standard Jest test suite structure for a given file.
**Triggers**:

- "Write tests for this"
- "Add unit tests"

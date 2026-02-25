# Verifying Copilot Configuration Interactions

This guide demonstrates how specific rules in `.github/copilot-instructions.md` influence Copilot's behavior. Follow these steps to see the configuration in action.

## Interaction 1: Code Style Enforcement

**Configuration Applied**:
> **Source**: `.github/copilot-instructions.md` (Section: `## Code Style`)

- `Code Style`: Use **TypeScript** for all logic.
- `Code Style`: Prefer `const` over `let`.
- `Code Style`: Use **Arrow functions**.
- `Code Style`: All exported functions must have **JSDoc comments**.

**Step-by-Step**:
1. Open `src/validation.ts`.
2. Open Copilot Chat (`Cmd+I` / `Ctrl+I` or the Chat panel).
3. Enter prompt: **"Write a function to format a currency value."**

**Expected Output**:
Copilot generates a strictly typed TypeScript arrow function with JSDoc comments.
```typescript
/**
 * Formats a number as a currency string.
 * @param amount - The numeric amount to format.
 * @param currency - The currency code (e.g., 'USD').
 * @returns The formatted currency string.
 */
export const formatCurrency = (amount: number, currency: string = 'USD'): string => {
    const formatter = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
    });
    return formatter.format(amount);
};
```

---

## Interaction 2: Testing Framework & Coverage

**Configuration Applied**:
> **Source**: `.github/copilot-instructions.md` (Section: `## Testing`) & `.github/prompts/create-test.prompt.md`

- `Testing`: Use `jest` for unit tests.
- `Testing`: Always include a test case for **edge cases** (null, undefined, etc.).
- `Prompt`: The `/create-test` command is defined in the prompt file.

**Step-by-Step**:
1. Highlight the `validateEmail` function in `src/validation.ts`.
2. Open Copilot Chat.
3. Enter prompt: **"/create-test"** (or type "Generate tests for the selected function").

**Expected Output**:
Copilot generates tests using `describe` and `test` (Jest syntax) and automatically includes negative test cases (empty string, invalid format) without being explicitly asked.
```typescript
describe('validateEmail', () => {
    test('should return true for valid email', () => { ... });
    test('should return false for empty string', () => { ... }); // Edge case enforced by config
    test('should return false for invalid format', () => { ... });
});
```

> **Note**: Checking that the slash command **`/create-test`** also respects the configuration file is a critical verification step.

---

## Interaction 3: Documentation Agent

**Configuration Applied**:
> **Source**: `.github/agents/docs-agent.md`

- **Agent Name**: Documentation Specialist
- **Responsibility**: Ensure all code has up-to-date and compliant documentation.
- **Behavior**: Returns file content with added comments without modifying logic.

**Step-by-Step**:
1. Open `src/validation.ts`.
2. Open Copilot Chat.
3. Enter prompt: **"Hey Copilot, document this file."**

**Expected Output**:
Copilot adopts the "Documentation Specialist" persona and adds JSDoc comments to all exported functions, explaining parameters and return values, exactly as defined in the agent file.
```typescript
/**
 * Validates if the input string is a valid email format.
 * @param email - The string to validate.
 * @returns True if valid, false otherwise.
 */
export const validateEmail = (email: string): boolean => {
    // ...
};
```

---

## Interaction 4: Leveraging Custom Skills

**Configuration Applied**:
> **Source**: `.github/skills/skills.md`

- **Skill**: `checkPasswordStrength`
- **Description**: Verifies if a password meets security standards (Min 8 chars, 1 Upper, 1 Lower, 1 Number).

**Step-by-Step**:
1. Open Copilot Chat.
2. Enter prompt: **"Write a function to validate a new user password."**

**Expected Output**:
Copilot recognizes the intent matches the `checkPasswordStrength` skill and implements the specific logic defined in `skills.md` (checking for uppercase, lowercase, number, and length).

```typescript
export const isPasswordSecure = (password: string): boolean => {
    // Logic derived from the "checkPasswordStrength" skill definition
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const isValidLength = password.length >= 8;

    return hasUpper && hasLower && hasNumber && isValidLength;
};
```
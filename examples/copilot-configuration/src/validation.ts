/**
 * Validates if the provided string is a valid US phone number.
 * 
 * @param phone - The phone number string to validate.
 * @returns {boolean} True if the phone number matches the US format, false otherwise.
 */
export function validatePhone(phone: string): boolean {
    // Check if phone is valid US number
    const re = /^\(?(\d{3})\)?[- ]?(\d{3})[- ]?(\d{4})$/;
    return re.test(phone);
}

/**
 * Processes a user object to determine eligibility based on age.
 * 
 * @param user - The user object containing user details, specifically age.
 * @returns {boolean} True if the user is 18 or older, false otherwise.
 */
export function processUserData(user: any): boolean {
    if (user.age < 18) {
        return false;
    }
    return true;
}

/**
 * Validates if the provided string is a valid email format.
 * 
 * @param email - The email string to validate.
 * @returns {boolean} True if the email format is valid.
 */
export function validateEmail(email: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Verifies if a password meets security standards (Min 8 chars, 1 Upper, 1 Lower, 1 Number).
 * 
 * @param password - The password string to check.
 * @returns {boolean} True if the password is strong.
 */
export function checkPasswordStrength(password: string): boolean {
    if (password.length < 8) return false;
    if (!/[A-Z]/.test(password)) return false;
    if (!/[a-z]/.test(password)) return false;
    if (!/\d/.test(password)) return false;
    return true;
}

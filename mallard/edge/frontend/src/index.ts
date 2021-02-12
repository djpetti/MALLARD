/**
 * Shows a greeting to the user.
 * @param {string} person The user to greet.
 * @return {string} The generated greeting.
 */
function greeter(person: string) {
  return "Hello, " + person;
}

const user = "Daniel Petti";

document.body.textContent = greeter(user);

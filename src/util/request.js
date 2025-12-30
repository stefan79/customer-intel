
export default function validateRequest(zodSchema) {
  return function validate(request) {
    const payload =
      typeof request === "string" ? JSON.parse(request) : request ?? {};
    try {
      return zodSchema.parse(payload);
    } catch (error) {
      console.error("Request validation failed", payload);
      throw error;
    }
  };
}

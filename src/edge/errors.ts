export class EdgeRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeRequestError";
  }
}

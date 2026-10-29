// An error the client should see as-is: an HTTP status, a stable code and a sentence a person can act on.
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what) => new HttpError(404, 'not-found', `That ${what} doesn’t exist or was deleted.`);

export class HTTPResponseError extends Error {
  constructor(private response: Response) {
    super(`HTTP Error Response: ${response.status} ${response.statusText}`)
    this.response = response
  }
}

export class Base extends Error {
    name: string
    statusCode: number
    constructor(name: string, msg: string, statusCode: number) {
      super(msg)
      this.name = name
      this.statusCode = statusCode
    }
  }
  
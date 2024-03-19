import { DbConnection, DbTransaction } from '@crowd/database'
import { QueryTypes, Sequelize, Transaction } from 'sequelize'
import pgp from 'pg-promise'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface QueryExecutor {
  select(query: string, params?: object): Promise<any>
  selectNone(query: string, params?: object): Promise<void>
  selectOneOrNone(query: string, params?: object): Promise<any>
  selectOne(query: string, params?: object): Promise<any>
  result(query: string, params?: object): Promise<any>

  tx<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>
}

function formatQuery(query, params?) {
  return pgp.as.format(query, params)
}

export class SequelizeQueryExecutor implements QueryExecutor {
  constructor(private readonly sequelize: Sequelize) {}

  protected prepareOptions(options: any): any {
    return options
  }

  select(query: string, params?: object): Promise<any> {
    return this.sequelize.query(
      formatQuery(query, params),
      this.prepareOptions({
        type: QueryTypes.SELECT,
      }),
    )
  }
  async selectNone(query: string, params?: object): Promise<void> {
    const result = await this.sequelize.query(
      formatQuery(query, params),
      this.prepareOptions({
        type: QueryTypes.SELECT,
      }),
    )
    if (result.length > 0) {
      throw new Error('Expected no rows')
    }
  }
  async selectOneOrNone(query: string, params?: object): Promise<any> {
    const result = await this.sequelize.query(
      formatQuery(query, params),
      this.prepareOptions({
        type: QueryTypes.SELECT,
      }),
    )
    if (result.length > 1) {
      throw new Error('Expected at most one row')
    }

    return result[0]
  }
  async selectOne(query: string, params?: object): Promise<any> {
    const result: any = await this.sequelize.query(
      formatQuery(query, params),
      this.prepareOptions({
        type: QueryTypes.SELECT,
      }),
    )
    if (result.length !== 1) {
      throw new Error('Expected exactly one row')
    }

    return result[0]
  }
  async result(query: string, params?: object): Promise<any> {
    const [, result] = await this.sequelize.query(
      formatQuery(query, params),
      this.prepareOptions({}),
    )
    return result
  }

  async tx<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    const transaction = await this.sequelize.transaction()

    return fn(new TransactionalSequelizeQueryExecutor(this.sequelize, transaction))
  }
}

export class TransactionalSequelizeQueryExecutor extends SequelizeQueryExecutor {
  constructor(sequelize: Sequelize, private readonly transaction: Transaction) {
    super(sequelize)
  }

  protected prepareOptions(options: any): any {
    return {
      ...super.prepareOptions(options),
      transaction: this.transaction,
    }
  }
}

export class PgPromiseQueryExecutor implements QueryExecutor {
  constructor(private readonly db: DbConnection | DbTransaction) {}

  select(query: string, params?: object): Promise<any> {
    return this.db.query(formatQuery(query, params))
  }
  selectNone(query: string, params?: object): Promise<void> {
    return this.db.none(formatQuery(query, params))
  }
  selectOneOrNone(query: string, params?: object): Promise<any> {
    return this.db.oneOrNone(formatQuery(query, params))
  }
  selectOne(query: string, params?: object): Promise<any> {
    return this.db.one(formatQuery(query, params))
  }
  result(query: string, params?: object): Promise<any> {
    return this.db.result(formatQuery(query, params))
  }

  tx<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
    return this.db.tx((tx) => fn(new PgPromiseQueryExecutor(tx)))
  }
}
import { registerAs } from '@nestjs/config';
import { DataSourceOptions } from 'typeorm';

export default registerAs(
  'database',
  (): DataSourceOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'chess_platform_db',
    entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
    synchronize: process.env.NODE_ENV !== 'production' && process.env.DB_SYNC === 'true',
    logging: process.env.DB_LOGGING === 'true',
    migrations: [__dirname + '/../../../migrations/**/*{.ts,.js}'],
    migrationsTableName: 'migrations',
    migrationsRun: false,
  }),
);

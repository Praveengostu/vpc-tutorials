import express from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import cookieSession from "cookie-session";
import morgan from "morgan";
import { hostname } from "os";
import chalk from "chalk";
import { join } from 'path';
import { Pool } from 'pg';
import ibmcossdk from 'ibm-cos-sdk';
import fs from 'fs';
import uuidv5 from 'uuid/v5';

import config from "../config/config.json";

const port = 80;
const APP_BUILD_PATH = "build";
const { NODE_ENV = "development" } = process.env;
const isLocal = NODE_ENV !== "production";
const cookieSecret = config.cookie;
const expiresIn = 1 * 1 * 15 * 60; // days * hours * minutes * seconds  = 15 minutes
const cookiesPrefix = require("../package.json").prefixes
  .cookiesPrefix;

const custom =
  ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms :pid :local-address';

const system = require("./utils/logger").systemLog(APP_BUILD_PATH);
const access = require("./utils/logger").accessLog(APP_BUILD_PATH);
const app = express();

app.use(compression());

morgan.token("pid", req => process.pid);
morgan.token("local-address", req => req.socket.address().port);

app.use(morgan(custom, { skip: (req, res) => res.statusCode < 400 }));
app.use(morgan(custom, { stream: access }));
app.use(cookieParser());
app.use(
  cookieSession({
    name: `${cookiesPrefix}session`,
    secret: cookieSecret,
    maxAge: expiresIn * 1000, // expiresIn * ms
    httpOnly: true, // default is true
    secure: true, // default is true
    signed: true // default is true
  })
);

(async function connectDBCOSAddRoutes() {
  if (config.cloud_object_storage) {
    const cos_credentials = require("../config/cos_credentials.json");
    const { getEndpoints } = require('./lib/cos');
    const pg_credentials = require("../config/pg_credentials.json");

    let cos;
    const { guid, cloud_object_storage: { bucketName, endpoint_type, region, type, location } } = config;

    let endpoints = await getEndpoints(`${cos_credentials[0].credentials.endpoints}`, type);
    if (endpoints["service-endpoints"]) {
      let endpoint = endpoints["service-endpoints"][endpoint_type][region][type][location]

      let cos_config = {
        endpoint: endpoint,
        apiKeyId: cos_credentials[0].credentials.apikey,
        ibmAuthEndpoint: 'https://iam.cloud.ibm.com/identity/token',
        serviceInstanceId: cos_credentials[0].credentials.resource_instance_id
      };
      
      cos = new ibmcossdk.S3(cos_config);
    }

    let postgresconn = pg_credentials[0].credentials.connection.postgres;
    let database_config = {
      connectionString: postgresconn.composed[0],
      ssl: {
        ca: Buffer.from(postgresconn.certificate.certificate_base64, 'base64').toString()
      }
    };

    // Create a pool.
    let pool = new Pool(database_config);

    pool.on('error', (err) => {
      console.error(`${chalk.red(`Unexpected error on idle client`)}`, err.stack)
    });

    require("./bank/routes")(app, pool, cos, `${bucketName}-${uuidv5(bucketName, guid)}`);
  }

  if (config.cockroach) {
    const { cockroach: { user, host, database, port } } = config;
    let database_config = {
      user: user,
      host: host,
      database: database,
      port: port,
      connectionTimeoutMillis: 2000,
      ssl: {
        ca: fs.readFileSync(join(__dirname, '../certs/ca.crt')).toString(),
        key: fs.readFileSync(join(__dirname,'../certs/client.maxroach.key')).toString(),
        cert: fs.readFileSync(join(__dirname,'../certs/client.maxroach.crt')).toString()
      }
    };

    // Create a pool.
    let pool = new Pool(database_config);
    
    pool.on('error', (err) => {
      console.error(`${chalk.red(`Unexpected error on idle client`)}`, err.stack)
    });

    require("./bank/routes")(app, pool);
  }

  app.use("/health", function (req, res, next) {
    res.json({status: 'UP'});
  });

  // Following middleware and routes need to come in order before app.listen
  app.get('*', (req,res) => {
      res.sendFile(join(__dirname,'./public/index.html'));
  });

  app.use((req, res, next) => {
      let err = new Error('The address or route you entered does not exist on this server.');
      err.status = 404;
      err.code = 'ROUTE_NOT_FOUND'
      next(err);
  });

  app.use((err, req, res, next) => {
      res.status(err.status || 500).send({
          data: {},
          errors: [{
              message: err.message,
              code: err.code,
              timestamp: ""
          }]
      });
  });

  app.listen(port, () => {
    system.info(`Server process ${process.pid} is listening on ${hostname}:${port}`);
    console.log(
      `Use the following uri to access the app using your server or load balancer hostname: ${chalk.green(`/api/bank`)}`
    );
  });

}())
  .catch(error => console.error(error));
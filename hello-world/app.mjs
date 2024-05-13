import AWS from "aws-sdk";
import mysql from "mysql";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const secret_name = "prod/tech";

const client = new SecretsManagerClient({
  region: "us-east-1",
});

const cognitoidentityserviceprovider = new AWS.CognitoIdentityServiceProvider();

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */

export const lambdaHandler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const cpf = event.cpf;

  const queryAsync = (sql, connection) => {
    return new Promise((resolve, reject) => {
      connection.query(sql, (error, results) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      });
    });
  };
  if (!cpf) {
    return {
      statusCode: 400,
      body: JSON.stringify("CPF não fornecido"),
    };
  }
  try {
    const secretResponse = await client.send(
      new GetSecretValueCommand({
        SecretId: secret_name,
        VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
      })
    );

    const secret = JSON.parse(secretResponse.SecretString);

    const dbParams = {
      host: secret.host,
      port: secret.port,
      user: secret.username,
      password: secret.password,
      database: secret.dbname,
    };

    const connection = mysql.createConnection(dbParams);

    connection.connect(function (err) {
      if (err) context.fail();
    });
    const sql = `Select * from clientes where cpf = "${cpf}"`;
    const resultado = await queryAsync(sql, connection);

    connection.end();

    if (resultado.length) {
      // cria usuario
      const params = {
        UserPoolId: process.env.USER_POOL_ID,
        Username: resultado[0].email,
        DesiredDeliveryMediums: ["EMAIL"],
        UserAttributes: [
          {
            Name: "given_name",
            Value: resultado[0].nome,
          },
          {
            Name: "email",
            Value: resultado[0].email,
          },
        ],
      };

      await cognitoidentityserviceprovider.adminCreateUser(params).promise();

      const response = {
        statusCode: 200,
        body: JSON.stringify({
          message: "Cliente adicionado com sucesso",
        }),
      };

      return response;
    }

    const response = {
      statusCode: 401,
      body: JSON.stringify({
        message: "Não autorizado",
      }),
    };

    return response;

    // Desconectar do banco de dados
  } catch (error) {
    console.error("Erro :", error);
  }
};

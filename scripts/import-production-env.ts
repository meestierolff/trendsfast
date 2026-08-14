import { reportHobbyImportError, runHobbyEnvironmentImport } from "./import-hobby-environment";

try {
  runHobbyEnvironmentImport("public");
} catch (error) {
  reportHobbyImportError(error);
}

import { reportHobbyImportError, runHobbyEnvironmentImport } from "./import-hobby-environment";

try {
  runHobbyEnvironmentImport("ops");
} catch (error) {
  reportHobbyImportError(error);
}

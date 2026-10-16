declare module "occt-import-js" {
  export default function Module(options: {
    locateFile: (path: string) => string;
  }): Promise<{
    ReadStepFile(
      bytes: Uint8Array,
      options: {
        linearUnit: string;
        linearDeflectionType: string;
        linearDeflection: number;
        angularDeflection: number;
      },
    ): import("./lib/step-mesh").CadResult;
  }>;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Owner of all rows this request may read or write. */
    ownerId: string;
  };
};

import { Logger } from "effect";

export const containerLoggingLayer = Logger.layer([Logger.consoleJson]);

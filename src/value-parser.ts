import Parser, { ParserOptions } from './token/stream-parser';
import { Metadata, readCollation } from './metadata-parser';
import { TYPE } from './data-type';

import iconv from 'iconv-lite';
import { sprintf } from 'sprintf-js';
import { bufferToLowerCaseGuid, bufferToUpperCaseGuid } from './guid-parser';
import { convertLEBytesToString } from './tracking-buffer/buffer-to-string';
import { CustomParserCallback, CustomParsers, DateTimeObject } from './connection';

convertLEBytesToString

const NULL = (1 << 16) - 1;
const MAX = (1 << 16) - 1;
const THREE_AND_A_THIRD = 3 + (1 / 3);
const MONEY_DIVISOR = 10000;
const PLP_NULL = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
const UNKNOWN_PLP_LEN = Buffer.from([0xFE, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
const DEFAULT_ENCODING = 'utf8';

function readTinyInt(parser: Parser, callback: (value: unknown) => void) {
  parser.readUInt8(callback);
}

function readSmallInt(parser: Parser, callback: (value: unknown) => void) {
  parser.readInt16LE(callback);
}

function readInt(parser: Parser, callback: (value: unknown) => void) {
  parser.readInt32LE(callback);
}

function readBigInt(parser: Parser, callback: (value: unknown) => void) {
  parser.readBigInt64LE((value) => {
    callback(value.toString());
  });
}

function readReal(parser: Parser, callback: (value: unknown) => void) {
  parser.readFloatLE(callback);
}

function readFloat(parser: Parser, callback: (value: unknown) => void) {
  parser.readDoubleLE(callback);
}

function readSmallMoney(parser: Parser, asString :boolean, callback: (value: unknown) => void) {
  parser.readInt32LE((value) => {
    value = value / MONEY_DIVISOR;
    callback(asString ? value.toFixed(4) : value);
  });
}

function readMoney(parser: Parser, asString: boolean, callback: (value: unknown) => void) {
  parser.readInt32LE((high) => {
    parser.readUInt32LE((low) => {
      let value: string |number;
      if (asString) {
        const sum = (BigInt(low) + (BigInt(0x100000000) * BigInt(high))).toString();
        const dotPosition = sum.length - 4;
        value = sum.slice(0, dotPosition) + "." + sum.slice(dotPosition);
      } else {
        value = (low + 0x100000000 * high) / MONEY_DIVISOR
      }
      callback(value);
    });
  });
}

function readBit(parser: Parser, callback: (value: unknown) => void) {
  parser.readUInt8((value) => {
    callback(!!value);
  });
}

function valueParse(parser: Parser, metadata: Metadata, options: ParserOptions, callback: (value: unknown) => void): void {
  const type = metadata.type;

  callback = getCustomCallback(type.name, options, callback);

  switch (type.name) {
    case 'Null':
      return callback(null);

    case 'TinyInt':
      return readTinyInt(parser, callback);

    case 'SmallInt':
      return readSmallInt(parser, callback);

    case 'Int':
      return readInt(parser, callback);

    case 'BigInt':
      return readBigInt(parser, callback);

    case 'IntN':
      return parser.readUInt8((dataLength) => {
        switch (dataLength) {
          case 0:
            return callback(null);

          case 1:
            callback = getCustomCallback('TinyInt', options, callback);
            return readTinyInt(parser, callback);
          case 2:
            callback = getCustomCallback('SmallInt', options, callback);
            return readSmallInt(parser, callback);
          case 4:
            callback = getCustomCallback('Int', options, callback);
            return readInt(parser, callback);
          case 8:
            callback = getCustomCallback('BigInt', options, callback);
            return readBigInt(parser, callback);

          default:
            throw new Error('Unsupported dataLength ' + dataLength + ' for IntN');
        }
      });

    case 'Real':
      return readReal(parser, callback);

    case 'Float':
      return readFloat(parser, callback);

    case 'FloatN':
      return parser.readUInt8((dataLength) => {
        switch (dataLength) {
          case 0:
            return callback(null);

          case 4:
            callback = getCustomCallback('Real', options, callback);
            return readReal(parser, callback);
          case 8:
            callback = getCustomCallback('Float', options, callback);
            return readFloat(parser, callback);

          default:
            throw new Error('Unsupported dataLength ' + dataLength + ' for FloatN');
        }
      });

    case 'SmallMoney':
      return readSmallMoney(parser, options.returnMoneyAsString, callback);

    case 'Money':
      return readMoney(parser, options.returnMoneyAsString, callback);

    case 'MoneyN':
      return parser.readUInt8((dataLength) => {
        switch (dataLength) {
          case 0:
            return callback(null);

          case 4:
            callback = getCustomCallback('SmallMoney', options, callback);
            return readSmallMoney(parser, options.returnMoneyAsString, callback);
          case 8:
            callback = getCustomCallback('Money', options, callback);
            return readMoney(parser, options.returnMoneyAsString, callback);

          default:
            throw new Error('Unsupported dataLength ' + dataLength + ' for MoneyN');
        }
      });

    case 'Bit':
      return readBit(parser, callback);

    case 'BitN':
      return parser.readUInt8((dataLength) => {
        switch (dataLength) {
          case 0:
            return callback(null);

          case 1:
            callback = getCustomCallback('Bit', options, callback);
            return readBit(parser, callback);

          default:
            throw new Error('Unsupported dataLength ' + dataLength + ' for BitN');
        }
      });

    case 'VarChar':
    case 'Char':
      callback = getCustomCallback('Char', options, callback);
      const codepage = metadata.collation!.codepage!;
      if (metadata.dataLength === MAX) {
        return readMaxChars(parser, codepage, callback);
      } else {
        return parser.readUInt16LE((dataLength) => {
          if (dataLength === NULL) {
            return callback(null);
          }

          readChars(parser, dataLength!, codepage, callback);
        });
      }

    case 'NVarChar':
    case 'NChar':
      callback = getCustomCallback('NChar', options, callback);
      if (metadata.dataLength === MAX) {
        return readMaxNChars(parser, callback);
      } else {
        return parser.readUInt16LE((dataLength) => {
          if (dataLength === NULL) {
            return callback(null);
          }

          readNChars(parser, dataLength!, callback);
        });
      }

    case 'VarBinary':
    case 'Binary':
      callback = getCustomCallback('Binary', options, callback);
      if (metadata.dataLength === MAX) {
        return readMaxBinary(parser, callback);
      } else {
        return parser.readUInt16LE((dataLength) => {
          if (dataLength === NULL) {
            return callback(null);
          }

          readBinary(parser, dataLength!, callback);
        });
      }

    case 'Text':
      return parser.readUInt8((textPointerLength) => {
        if (textPointerLength === 0) {
          return callback(null);
        }

        parser.readBuffer(textPointerLength, (_textPointer) => {
          parser.readBuffer(8, (_timestamp) => {
            parser.readUInt32LE((dataLength) => {
              readChars(parser, dataLength!, metadata.collation!.codepage!, callback);
            });
          });
        });
      });

    case 'NText':
      return parser.readUInt8((textPointerLength) => {
        if (textPointerLength === 0) {
          return callback(null);
        }

        parser.readBuffer(textPointerLength, (_textPointer) => {
          parser.readBuffer(8, (_timestamp) => {
            parser.readUInt32LE((dataLength) => {
              readNChars(parser, dataLength!, callback);
            });
          });
        });
      });

    case 'Image':
      return parser.readUInt8((textPointerLength) => {
        if (textPointerLength === 0) {
          return callback(null);
        }

        parser.readBuffer(textPointerLength, (_textPointer) => {
          parser.readBuffer(8, (_timestamp) => {
            parser.readUInt32LE((dataLength) => {
              readBinary(parser, dataLength!, callback);
            });
          });
        });
      });

    case 'Xml':
      return readMaxNChars(parser, callback);

    case 'SmallDateTime':
      return readSmallDateTime(parser, options.useUTC, options.returnDateTimeAsObject, callback);

    case 'DateTime':
      return readDateTime(parser, options.useUTC, options.returnDateTimeAsObject, callback);

    case 'DateTimeN':
      return parser.readUInt8((dataLength) => {
        switch (dataLength) {
          case 0:
            return callback(null);

          case 4:
            callback = getCustomCallback('SmallDateTime', options, callback);
            return readSmallDateTime(parser, options.useUTC, options.returnDateTimeAsObject, callback);
          case 8:
            callback = getCustomCallback('DateTime', options, callback);
            return readDateTime(parser, options.useUTC, options.returnDateTimeAsObject, callback);

          default:
            throw new Error('Unsupported dataLength ' + dataLength + ' for DateTimeN');
        }
      });

    case 'Time':
      return parser.readUInt8((dataLength) => {
        if (dataLength === 0) {
          return callback(null);
        } else {
          return readTime(parser, dataLength!, metadata.scale!, options.useUTC, options.returnDateTimeAsObject, callback);
        }
      });

    case 'Date':
      return parser.readUInt8((dataLength) => {
        if (dataLength === 0) {
          return callback(null);
        } else {
          return readDate(parser, options.useUTC, options.returnDateTimeAsObject, callback);
        }
      });

    case 'DateTime2':
      return parser.readUInt8((dataLength) => {
        if (dataLength === 0) {
          return callback(null);
        } else {
          return readDateTime2(parser, dataLength!, metadata.scale!, options.useUTC, options.returnDateTimeAsObject, callback);
        }
      });

    case 'DateTimeOffset':
      return parser.readUInt8((dataLength) => {
        if (dataLength === 0) {
          return callback(null);
        } else {
          return readDateTimeOffset(parser, dataLength!, metadata.scale!, options.returnDateTimeAsObject, callback);
        }
      });

    case 'NumericN':
    case 'DecimalN':
      callback = getCustomCallback('Decimal', options, callback);
      return parser.readUInt8((dataLength) => {
        if (dataLength === 0) {
          return callback(null);
        } else {
          return readNumeric(parser, dataLength!, metadata.precision!, metadata.scale!, options.returnDecimalAndNumericAsString, callback);
        }
      });

    case 'UniqueIdentifier':
      return parser.readUInt8((dataLength) => {
        switch (dataLength) {
          case 0:
            return callback(null);

          case 0x10:
            return readUniqueIdentifier(parser, options, callback);

          default:
            throw new Error(sprintf('Unsupported guid size %d', dataLength! - 1));
        }
      });

    case 'UDT':
      return readMaxBinary(parser, callback);

    case 'Variant':
      return parser.readUInt32LE((dataLength) => {
        if (dataLength === 0) {
          return callback(null);
        }

        readVariant(parser, options, dataLength!, callback);
      });

    default:
      throw new Error(sprintf('Unrecognised type %s', type.name));
  }
}

function readUniqueIdentifier(parser: Parser, options: ParserOptions, callback: (value: unknown) => void) {
  parser.readBuffer(0x10, (data) => {
    callback(options.lowerCaseGuids ? bufferToLowerCaseGuid(data) : bufferToUpperCaseGuid(data));
  });
}

function readNumeric(parser: Parser, dataLength: number, _precision: number, scale: number, asString: boolean, callback: (value: unknown) => void) {
  parser.readUInt8((sign) => {
    if (asString) {
      let readValue;

      if (dataLength === 5) {
        readValue = parser.readUInt32LE;
      } else if (dataLength === 9) {
        readValue = parser.readUNumeric64LEBI;
      } else {
        readValue = parser.readLEBytesAsString(dataLength - 1);
      }

      readValue.call(parser, (value: number| bigint | string) => {
        value = value.toString();
        value = value.padStart(scale + 1, '0');
        const idx = value.length - scale;
        const int = value.slice(0, idx);
        const dec = value.slice(idx)
        value = int + (dec ? '.' + dec : '');
        if (sign == -1) value = '-' + value;
        callback(value);
      });
    } else {
      sign = sign === 1 ? 1 : -1;
      let readValue;

      if (dataLength === 5) {
        readValue = parser.readUInt32LE;
      } else if (dataLength === 9) {
        readValue = parser.readUNumeric64LE;
      } else if (dataLength === 13) {
        readValue = parser.readUNumeric96LE;
      } else if (dataLength === 17) {
        readValue = parser.readUNumeric128LE;
      } else {
        throw new Error(sprintf('Unsupported numeric dataLength %d', dataLength));
      }

      readValue.call(parser, value => {
        callback(value * sign / Math.pow(10, scale));
      });
    }
  });
}

function readVariant(parser: Parser, options: ParserOptions, dataLength: number, callback: (value: unknown) => void) {
  return parser.readUInt8((baseType) => {
    const type = TYPE[baseType];

    callback = getCustomCallback(type.name, options, callback);

    return parser.readUInt8((propBytes) => {
      dataLength = dataLength - propBytes - 2;

      switch (type.name) {
        case 'UniqueIdentifier':
          return readUniqueIdentifier(parser, options, callback);

        case 'Bit':
          return readBit(parser, callback);

        case 'TinyInt':
          return readTinyInt(parser, callback);

        case 'SmallInt':
          return readSmallInt(parser, callback);

        case 'Int':
          return readInt(parser, callback);

        case 'BigInt':
          return readBigInt(parser, callback);

        case 'SmallDateTime':
          return readSmallDateTime(parser, options.useUTC, options.returnDateTimeAsObject, callback);

        case 'DateTime':
          return readDateTime(parser, options.useUTC, options.returnDateTimeAsObject, callback);

        case 'Real':
          return readReal(parser, callback);

        case 'Float':
          return readFloat(parser, callback);

        case 'SmallMoney':
          return readSmallMoney(parser, options.returnMoneyAsString, callback);

        case 'Money':
          return readMoney(parser, options.returnMoneyAsString, callback);

        case 'Date':
          return readDate(parser, options.useUTC, options.returnDateTimeAsObject, callback);

        case 'Time':
          return parser.readUInt8((scale) => {
            return readTime(parser, dataLength, scale, options.useUTC, options.returnDateTimeAsObject, callback);
          });

        case 'DateTime2':
          return parser.readUInt8((scale) => {
            return readDateTime2(parser, dataLength, scale, options.useUTC, options.returnDateTimeAsObject, callback);
          });

        case 'DateTimeOffset':
          return parser.readUInt8((scale) => {
            return readDateTimeOffset(parser, dataLength, scale, options.returnDateTimeAsObject, callback);
          });

        case 'VarBinary':
        case 'Binary':
          callback = getCustomCallback('Binary', options, callback);
          return parser.readUInt16LE((_maxLength) => {
            readBinary(parser, dataLength, callback);
          });

        case 'NumericN':
        case 'DecimalN':
          callback = getCustomCallback('Binary', options, callback);
          return parser.readUInt8((precision) => {
            parser.readUInt8((scale) => {
              readNumeric(parser, dataLength, precision, scale, options.returnDecimalAndNumericAsString, callback);
            });
          });

        case 'VarChar':
        case 'Char':
          callback = getCustomCallback('Char', options, callback);
          return parser.readUInt16LE((_maxLength) => {
            readCollation(parser, (collation) => {
              readChars(parser, dataLength, collation.codepage!, callback);
            });
          });

        case 'NVarChar':
        case 'NChar':
          callback = getCustomCallback('NChar', options, callback);
          return parser.readUInt16LE((_maxLength) => {
            readCollation(parser, (_collation) => {
              readNChars(parser, dataLength, callback);
            });
          });

        default:
          throw new Error('Invalid type!');
      }
    });
  });
}

function readBinary(parser: Parser, dataLength: number, callback: (value: unknown) => void) {
  return parser.readBuffer(dataLength, callback);
}

function readChars(parser: Parser, dataLength: number, codepage: string, callback: (value: unknown) => void) {
  if (codepage == null) {
    codepage = DEFAULT_ENCODING;
  }

  return parser.readBuffer(dataLength, (data) => {
    callback(iconv.decode(data, codepage));
  });
}

function readNChars(parser: Parser, dataLength: number, callback: (value: unknown) => void) {
  parser.readBuffer(dataLength, (data) => {
    callback(data.toString('ucs2'));
  });
}

function readMaxBinary(parser: Parser, callback: (value: unknown) => void) {
  return readMax(parser, callback);
}

function readMaxChars(parser: Parser, codepage: string, callback: (value: unknown) => void) {
  if (codepage == null) {
    codepage = DEFAULT_ENCODING;
  }

  readMax(parser, (data) => {
    if (data) {
      callback(iconv.decode(data, codepage));
    } else {
      callback(null);
    }
  });
}

function readMaxNChars(parser: Parser, callback: (value: string | null) => void) {
  readMax(parser, (data) => {
    if (data) {
      callback(data.toString('ucs2'));
    } else {
      callback(null);
    }
  });
}

function readMax(parser: Parser, callback: (value: null | Buffer) => void) {
  parser.readBuffer(8, (type) => {
    if (type.equals(PLP_NULL)) {
      return callback(null);
    } else if (type.equals(UNKNOWN_PLP_LEN)) {
      return readMaxUnknownLength(parser, callback);
    } else {
      const low = type.readUInt32LE(0);
      const high = type.readUInt32LE(4);

      if (high >= (2 << (53 - 32))) {
        console.warn('Read UInt64LE > 53 bits : high=' + high + ', low=' + low);
      }

      const expectedLength = low + (0x100000000 * high);
      return readMaxKnownLength(parser, expectedLength, callback);
    }
  });
}

function readMaxKnownLength(parser: Parser, totalLength: number, callback: (value: null | Buffer) => void) {
  const data = Buffer.alloc(totalLength, 0);

  let offset = 0;
  function next(done: any) {
    parser.readUInt32LE((chunkLength) => {
      if (!chunkLength) {
        return done();
      }

      parser.readBuffer(chunkLength, (chunk) => {
        chunk.copy(data, offset);
        offset += chunkLength;

        next(done);
      });
    });
  }

  next(() => {
    if (offset !== totalLength) {
      throw new Error('Partially Length-prefixed Bytes unmatched lengths : expected ' + totalLength + ', but got ' + offset + ' bytes');
    }

    callback(data);
  });
}

function readMaxUnknownLength(parser: Parser, callback: (value: null | Buffer) => void) {
  const chunks: Buffer[] = [];

  let length = 0;
  function next(done: any) {
    parser.readUInt32LE((chunkLength) => {
      if (!chunkLength) {
        return done();
      }

      parser.readBuffer(chunkLength, (chunk) => {
        chunks.push(chunk);
        length += chunkLength;

        next(done);
      });
    });
  }

  next(() => {
    callback(Buffer.concat(chunks, length));
  });
}

function readSmallDateTime(parser: Parser, useUTC: boolean, asObject: boolean, callback: (value: Date | DateTimeObject) => void) {
  parser.readUInt16LE((days) => {
    parser.readUInt16LE((minutes) => {
      let value;
      if (asObject) {
        value = { startingYear: 1900, days: days, minutes: minutes };
      } else {
        if (useUTC) {
          value = new Date(Date.UTC(1900, 0, 1 + days, 0, minutes));
        } else {
          value = new Date(1900, 0, 1 + days, 0, minutes);
        }
      }
      callback(value);
    });
  });
}

function readDateTime(parser: Parser, useUTC: boolean, asObject: boolean, callback: (value: Date | DateTimeObject) => void) {
  parser.readInt32LE((days) => {
    parser.readUInt32LE((threeHundredthsOfSecond) => {
      const milliseconds = Math.round(threeHundredthsOfSecond * THREE_AND_A_THIRD);

      let value;
      if (asObject) {
        value = { startingYear: 1900, days: days, milliseconds: milliseconds };
      } else {
        if (useUTC) {
          value = new Date(Date.UTC(1900, 0, 1 + days, 0, 0, 0, milliseconds));
        } else {
          value = new Date(1900, 0, 1 + days, 0, 0, 0, milliseconds);
        }
      }

      callback(value);
    });
  });
}

export interface DateWithNanosecondsDelta extends Date {
  nanosecondsDelta: number;
}

function readTime(parser: Parser, dataLength: number, scale: number, useUTC: boolean, asObject: boolean, callback: (value: DateWithNanosecondsDelta | DateTimeObject, scale: number) => void) {
  let readValue: any;
  switch (dataLength) {
    case 3:
      readValue = parser.readUInt24LE;
      break;
    case 4:
      readValue = parser.readUInt32LE;
      break;
    case 5:
      readValue = parser.readUInt40LE;
  }

  readValue!.call(parser, (value: number) => {
    if (scale < 7) {
      for (let i = scale; i < 7; i++) {
        value *= 10;
      }
    }

    let date;
    if (asObject) {
      date = { startingYear: 1970, nanoseconds: value * 100 };
    } else {
      if (useUTC) {
        date = new Date(Date.UTC(1970, 0, 1, 0, 0, 0, value / 10000)) as DateWithNanosecondsDelta;
      } else {
        date = new Date(1970, 0, 1, 0, 0, 0, value / 10000) as DateWithNanosecondsDelta;
      }
      Object.defineProperty(date, 'nanosecondsDelta', {
        enumerable: false,
        value: (value % 10000) / Math.pow(10, 7)
      });
    }
    callback(date, scale);
  });
}

function readDate(parser: Parser, useUTC: boolean, asObject: boolean, callback: (value: Date | DateTimeObject) => void) {
  parser.readUInt24LE((days) => {
    if (asObject) {
      callback({ startingYear: 1, days: days });
    } else {
      if (useUTC) {
        callback(new Date(Date.UTC(2000, 0, days - 730118)));
      } else {
        callback(new Date(2000, 0, days - 730118));
      }
    }
  });
}

function readDateTime2(parser: Parser, dataLength: number, scale: number, useUTC: boolean, asObject: boolean, callback: (value: DateWithNanosecondsDelta | DateTimeObject, scale: number) => void) {
  readTime(parser, dataLength - 3, scale, useUTC, asObject, (time) => { // TODO: 'input' is 'time', but TypeScript cannot find "time.nanosecondsDelta";
    parser.readUInt24LE((days) => {
      let date;
      if (time instanceof Date) {
        if (useUTC) {
          date = new Date(Date.UTC(2000, 0, days - 730118, 0, 0, 0, +time)) as DateWithNanosecondsDelta;
        } else {
          date = new Date(2000, 0, days - 730118, time.getHours(), time.getMinutes(), time.getSeconds(), time.getMilliseconds()) as DateWithNanosecondsDelta;
        }
        Object.defineProperty(date, 'nanosecondsDelta', {
          enumerable: false,
          value: time.nanosecondsDelta
        });
      } else {
        date = { ...time, startingYear: 1, days: days };
      }
      callback(date, scale);
    });
  });
}

function readDateTimeOffset(parser: Parser, dataLength: number, scale: number, asObject: boolean, callback: (value: DateWithNanosecondsDelta | DateTimeObject, scale: number) => void) {
  readTime(parser, dataLength - 5, scale, true, asObject, (time) => {
    parser.readUInt24LE((days) => {
      // offset
      parser.readInt16LE((offset) => {
        let date;
        if (time instanceof Date) {
          date = new Date(Date.UTC(2000, 0, days - 730118, 0, 0, 0, +time)) as DateWithNanosecondsDelta;
          Object.defineProperty(date, 'nanosecondsDelta', {
            enumerable: false,
            value: time.nanosecondsDelta
          });
        } else {
          date = { ...time, startingYear: 1, days: days, offset: offset }
        }
        callback(date, scale);
      });
    });
  });
}

function getCustomCallback(name: string, options: ParserOptions, callback: (value: unknown) => void): (value: unknown) => void {
  if (options.customParsers == null || !(name in options.customParsers) || typeof options.customParsers[name as keyof CustomParsers] !== 'function') {
    return callback;
  }
  const customParserCallback = options.customParsers[name as keyof CustomParsers] as CustomParserCallback;
  const originalCallback = callback;
  return (...value) => {
    return customParserCallback(originalCallback, ...value);
  }
}

export default valueParse;
module.exports = valueParse;

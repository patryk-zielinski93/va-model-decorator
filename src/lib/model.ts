import 'reflect-metadata';

const propertyDecoratorKey = '__VaModelProp__';

export function isPrimitive(value: any): boolean {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return true;
  }
  return (value instanceof String || value === String ||
    value instanceof Number || value === Number ||
    value instanceof Boolean || value === Boolean);
}

export function isArray(value: any): boolean {
  if (value === Array) {
    return true;
  } else if (typeof Array.isArray === 'function') {
    return Array.isArray(value);
  } else {
    return value instanceof Array;
  }
}

/**
 * Annotate properties which should be deserializable.
 * @param {any} [type] - class which should be used during creating object e.g.:
 * <code>
 * class Animal extends Model {
 *   @ModelProp()
 *   name: string;
 * }
 *
 * class Dog extends Animal {
 * }
 *
 * class Person {
 *   @ModelProp()
 *   name: string;
 *   @ModelProp(Dog) // <---- Dog class will be used during creating array of Dogs.
 *   dogs: Dog[]
 * }
 * </code>
 * @param {string} [sourceProperty] - name of source property, which will be mapped to target property.
 * @returns {PropertyDecorator}
 */
export function ModelProp(type?: any, sourceProperty?: string | symbol): PropertyDecorator {
  return (target, property) => {
    const source = sourceProperty || property;
    const classConstructor = target.constructor;
    const metadata = {
      targetProp: property,
      type: type || Reflect.getMetadata('design:type', target, property) || undefined
    };

    Reflect.defineMetadata(propertyDecoratorKey, metadata, classConstructor, source);
  };
}

export abstract class Model {
  /**
   * Parse provided object (e.g. data from server) into model instance.
   * @Todo: Support for nested arrays.
   * @Todo: Implement different object creation in array (e.g. Person have animals' array which can be Dog or Cat).
   * Probably it can't be achieved programmatically, so we have to set some standard for backend to return special
   * property in these kind of cases. Proposed solution: it can be _ClassModel_ property passed from server in json
   * string, which will be name of class to create object. In such solution @ModelClass decorator would be mandatory
   * (now it is not) for every class which extends Model. In this solution ModelClass decorator will keep track of every
   * able Class create new Object.
   * @param {any} data
   * @returns {T}
   */
  static deserialize<T extends Model>(data: any): T {
    const obj = new (<any>this)();

    if (!data) {
      return obj;
    }

    Object.keys(data).forEach((key) => {
      const metadata = Reflect.getMetadata(propertyDecoratorKey, this, key);
      // Return if provided key doesn't mach any decorated class member.
      if (!metadata) {
        return;
      }

      const targetProp = metadata.targetProp;
      let type = metadata.type;

      if (!type.name || type.name === 'anonymous') {
        type = type();
      }

      if (isPrimitive(data[key]) && isPrimitive(type)) {
        // Value is primitive type, assign it to object.
        obj[targetProp] = data[key];

      } else if (isArray(data[key])) {
        // If decorated property is type of array assign it to object. It means that values of array are primitive type.
        if (isArray(type)) {
          obj[targetProp] = data[key];
        } else {
          // If decorated property specified own type, deserialize it.
          obj[targetProp] = [];
          data[key].forEach((arrObj: any) => {
            obj[targetProp].push(type.deserialize ?
              type.deserialize(arrObj) : new type(data[key]));
          });
        }

      } else {
        // If is object and have deserialize method.
        if (type.deserialize && data[key]) {
          obj[targetProp] = type.deserialize(data[key]);
        } else {
          if (data[key]) {
            // If is instance of object just call new with provided data (e.g. Date).
            obj[targetProp] = new type(data[key]);
          } else {
            obj[targetProp] = data[key];
          }
        }
      }
    });

    return <T>obj;
  }

  /**
   * Do the same thing as deserialize, but if property from data doesn't exist in Model fields,
   * then it is still added to result model from data without changes.
   * @param data
   * @returns {T}
   */
  static deserializeLosslessly<T extends Model>(data: any): T {
    const obj: any = this.deserialize(data);

    Object.keys(data).forEach((key) => {
      if (obj[key] === undefined) {
        obj[key] = data[key];
      }
    });

    return obj;
  }

  /**
   * Returns deep clone of the object.
   * @returns {T}
   */
  clone<T extends Model>(): T {
    return <T>(<any>this).constructor.deserialize(this.serialize());
  }

  /**
   * Returns shallow copy of the object.
   * @returns {T}
   */
  copy<T extends Model>(): T {
    const data = {...<any>this};
    return <T>Object.assign(new (<any>this.constructor)(), data);
  }

  /**
   * Creates new object and maps sources' properties to this newly created object's properties.
   * @param sources
   * @returns {T}
   */
  mapToModel<T extends Model>(...sources: Object[]): T {
    return <T>(<any>this).constructor.deserialize(Object.assign(this.serialize(), ...sources));
  }

  /**
   * Serializes single property
   * @param property
   * @returns {any}
   */
  protected basicSerializeProperty(property: any): any {
    if (property && typeof property !== 'function') {
      if (typeof property.serialize === 'function') {
        return property.serialize();
      } else if (isArray(property)) {
        return property.map((element: any) => this.basicSerializeProperty(element));
      } else {
        return JSON.parse(JSON.stringify(property));
      }
    } else if (typeof property !== 'function') {
      return property;
    }
  }

  /**
   * Serializes model with all its properties
   * @returns {Object}
   */
  protected basicSerialize(): any {
    const obj: any = {};
    // tslint:disable-next-line forin
    for (const property in this) {
      obj[<string>property] = this.basicSerializeProperty(this[property]);
    }
    return obj;
  }

  /**
   * Serialize and return plain object without methods.
   * @param {string[]} exclude - array of property names which should be excluded from object (you can provide nested
   *                             properties e.g.: ['position.z']).
   * @returns {any}
   */

  serialize(exclude?: string[]): any {
    const obj = this.basicSerialize();

    if (exclude) {
      exclude.forEach(prop => {
        const arrProp = prop.split('.');
        const l = arrProp.length - 1;
        let toDelete = obj;

        for (let i = 0; i < l; i++) {
          if (!(arrProp[i] in toDelete)) {
            throw new Error('Property ' + prop + ' does not exist on ' + (<any>this.constructor).name);
          }
          toDelete = toDelete[arrProp[i]];
        }

        if (!(arrProp[l] in toDelete)) {
          throw new Error('Property ' + prop + ' does not exist on ' + (<any>this.constructor).name);
        }

        delete toDelete[arrProp[l]];
      });
    }

    return obj;
  }
}

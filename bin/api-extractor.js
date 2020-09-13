#!/usr/bin/env node

const path = require('path')
const fs = require('fs-extra')
const { flowRight, curry } = require('lodash')
const axios = require('axios')
const stringify = require('json-stable-stringify-without-jsonify')
const enquirer = require('enquirer')
const color = require('colors-console')

const defaultConfig = {
  serverAddress: '',
  outputDir: 'apiExtractor',
  fileName: 'apiResult'
}
const realUrl = `${defaultConfig.serverAddress}/v2/api-docs`
const saveDir = path.join(process.cwd(), `${defaultConfig.outputDir}/${defaultConfig.fileName}.json`)
const configFileName = '.apiextractorconfig.js'
const apiDescTem = {
  description: '',
  url: '',
  method: ''
}
const apiKeyDescTem = {
  type: '',
  description: ''
}
const paramsIn = [
  {
    value: 'query',
    key: 'params'
  },
  {
    value: 'body',
    key: 'data'
  },
  {
    value: 'formData',
    key: 'data'
  }
]
const reviseType = {
  integer: 'number'
}

// 初始化配置文件
if (process.argv.includes('--init')) {
  promptUser()
} else {
  startWork().catch(err => {
    console.log(color('red', err))
  })
}

// ------  工具函数START ------------

/** 判断属性在对象中是否存在
 * @method 方法名
 * @param{Object} targe 目标对象
 * @param{Array} keyArr 目标key和父key的数组
 * @return {Object} 返回目前对象
 */
function isExist (target, keyArr) {
  let isExist = true
  const lastResult = keyArr.reduce((lastResult, currentKey) => {
    if (!isExist) {
      return lastResult
    }
    const target = lastResult[currentKey]
    if (!target) {
      isExist = false
      return lastResult
    }
    return target
  }, target)
  return {
    isExist,
    lastResult
  }
}

// ------  工具函数END ------------

// ------  业务函数START ------------

/** 方法说明
 * @method 方法名
 * @param {参数类型} 参数名 参数说明
 * @return {返回值类型} 返回值说明
*/
function readConfig () {
  try {
    const configFile = require(path.join(process.cwd(), configFileName))
    Object.assign(defaultConfig, configFile)
    return Promise.resolve('读取配置成功')
  } catch (e) {
    onFatalError()
    return Promise.reject('读取配置失败')
  }
}

/** 捕获并报告意外错误
 * @method onFatalError
 * @param {参数类型} 参数名 参数说明
 * @return {返回值类型} 返回值说明
 */
function onFatalError () {
  const { version } = require('../package.json')

  console.error(`
Oops! Something went wrong! :(

api-extractor: ${version}

api-extractor couldn't find a configuration file. To set up a configuration file for this project, please run:

    api-extractor --init
`)
}

/** 将配置文件添加到.gitignore文件中
 * @method addIgnore
 * @return {返回值类型} 返回值说明
*/
function addIgnore () {
  try {
    const ignoreFile = fs.readFileSync(path.join(process.cwd(), '.gitignore'))
    if (!ignoreFile.toString().includes(configFileName)) {
      fs.writeFileSync(path.join(process.cwd(), '.gitignore'), ignoreFile + `\n\n${configFileName}`)
    }
  } catch (e) {
    fs.writeFileSync(path.join(process.cwd(), '.gitignore'), configFileName)
  }
}

/** 在命令提示符下询问一些问题
 * @method promptUser
 * @param {参数类型} 参数名 参数说明
 * @return {Promise} 提示结果的承诺
 */
function promptUser () {
  return enquirer.prompt([
    {
      type: 'input',
      name: 'serverAddress',
      message: '请输入接口所在的服务器地址：'
    },
    {
      type: 'input',
      name: 'outputDir',
      message: '你希望输出的文件存在在什么目录下（例子：假如你想存放在根目录下的apiResult/api目录下，则输入apiResult/api即可）：'
    },
    {
      type: 'input',
      name: 'fileName',
      message: '想给输出的文件取什么名字？请输入：'
    }
  ]).then(answers => {
    for (const key of Reflect.ownKeys(answers)) {
      !answers[key] && delete answers[key]
    }
    const config = Object.assign({}, defaultConfig, answers)
    addIgnore()
    writeFile(config)
  })
}

function sortByKey (a, b) {
  return a.key > b.key ? 1 : -1
}

/** 在当前工作目录中创建.apiextractorconfig.js文件
 * @method 方法名
 * @param {参数类型} 参数名 参数说明
 * @return {返回值类型} 返回值说明
 */
function writeFile (config) {
  const stringifiedContent = `module.exports = ${stringify(config, { cmp: sortByKey, space: 2 })};\n`
  fs.writeFileSync(path.join(process.cwd(), configFileName), stringifiedContent, 'utf8')
}

/** 获取数据
 *@method getData
 *@param {String} url 获取数据的地址
 *@return {Object} 接口返回的数据
*/
async function getData (url) {
  let result = {}
  if (/^(http|https):\/\//.test(url)) {
    result = await axios.get(url)
      .catch(() => {
        return Promise.reject('访问出错：' + url)
      })
    return result.data
  } else {
    return Promise.reject(`服务器地址必须包含HTTP协议，请前往${path.join(process.cwd(), configFileName)}配置文件修改`)
  }
}

/** 整理数据
 *@method sortData
 *@param {Object} data 需要整理的数据
 *@return {Object} 整理过后的数据
*/
function sortData ({ paths = {} }) {
  const result = {}
  const isExistCurry = curry(isExist)(result)
  for (const [key, val] of Object.entries(paths)) {
    // 通过'/'将路径分割成一个数组
    const apiUrlSplit = key.split('/').filter(item => item)
    // 数组的最后一个元素的下标
    const lastIndex = apiUrlSplit.length - 1
    apiUrlSplit.forEach((item, index) => {
      const target = isExistCurry(apiUrlSplit.slice(0, index + 1))
      if (index < lastIndex) {
        if (!target.isExist) {
          target.lastResult[item] = {}
        }
      } else {
        const [[method, pathValue = {}]] = Object.entries(val)
        const { summary: description, parameters = [] } = pathValue
        target.lastResult[item] = Object.assign({}, apiDescTem, {
          description,
          url: key,
          method
        }, handleParams(parameters))
      }
    })
  }
  return result
}

/** 处理请求的参数
 * @method handleApiBody
 * @param {Array} paramsArr 接口的parameters参数
 * @return {Object} 一个包含data或者params属性的对象
*/
function handleParams (paramsArr) {
  // 获取key值
  const value = paramsIn.find(item => paramsArr.some(key => key.in === item.value))
  // 没有参数则返回一个error对象
  if (!value) {
    return {
      error: {}
    }
  }
  // 过滤header参数
  const noHeader = paramsArr.filter(item => paramsIn.some(key => key.value === item.in))
  const result = {}
  noHeader.reduce((lastResult, { name, required, type, description }) => {
    lastResult[name] = Object.assign({}, apiKeyDescTem, {
      type: reviseType[type] || type || 'string',
      description
    })
    if (required) {
      lastResult[name].required = required
    }
    return lastResult
  }, result)
  return {
    [value.key]: result
  }
}

/** 将数据写入json文件
 * @method writeJson
 * @param {Object} data 需要写入的json数据
 * @return {void}
*/
function writeJson (data = {}) {
  try {
    fs.writeJsonSync(saveDir, data, { spaces: 2 })
  } catch (e) {
    fs.mkdirsSync(path.join(process.cwd(), defaultConfig.outputDir))
    fs.writeJsonSync(saveDir, data, { spaces: 2 })
  }
  console.log(color('green', `恭喜你呀，提取成功啦！可以在${saveDir}中查看数据`))
}

/**
 * @method startWork
 * @param {参数类型} 参数名 参数说明
 * @return {返回值类型} 返回值说明
*/
async function startWork () {
  const composeFn = flowRight(writeJson, sortData)
  await readConfig()
  const json = await getData(realUrl)
  composeFn(json)
}

// ------  业务函数END ------------
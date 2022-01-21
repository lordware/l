
const requests = () => {
  let time = 0;
  let objectOfTabsToStop = {}
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!/^https:\/\/(lichess\.org|lichess\.dev|mskchess\.ru)\/(\w{8}|\w{12})(\/white|\/black)?$/.test(details.url)) return;
      let tabId = details.tabId;
      let debuggeeId = { tabId: tabId };
      if (objectOfTabsToStop[tabId] && objectOfTabsToStop[tabId].debugger === true) {
        //injectContent(tabId);
        return;
      }
      objectOfTabsToStop[tabId] = { stop: true, debugger: false };
      chrome.debugger.attach(debuggeeId, '1.3', () => {
        objectOfTabsToStop[tabId].debugger = true;
        chrome.debugger.sendCommand(
          debuggeeId, "Debugger.enable", {},
          () => {
            console.log('debugger enabled', performance.now() - time);
            chrome.debugger.sendCommand(
              debuggeeId,
              "Fetch.enable",
              {
                patterns: [{
                  requestStage: "Response",
                  resourceType: "Document", urlPattern: '*lichess*'
                },
                {
                  requestStage: "Response",
                  resourceType: "Document", urlPattern: '*mskchess*'
                }]
              },
              () => {
                console.log('fetch enabled', performance.now() - time);
                objectOfTabsToStop[tabId].stop = false;
                chrome.tabs.update(tabId, { url: details.url })
              });
          });
      });
      return { redirectUrl: 'http://google.com/gen_204' }
    },
    {
      urls: ["https://lichess.org/*", "https://lichess.dev/*", "https://mskchess.ru/*"]
    },
    ["blocking"]
  );

  chrome.debugger.onEvent.addListener((debuggeeId, method, frameId, resourceType) => {
    if (method === "Fetch.requestPaused") {
      let requestId = frameId.requestId;
      if (frameId.resourceType === "Document") {
        if (!/^https:\/\/(lichess\.org|lichess\.dev|mskchess\.ru)\/(\w{8}|\w{12})(\/white|\/black)?$/.test(frameId.request.url)) {
          disableOnAnotherPage(debuggeeId, requestId)
          return;
        }
      }
      chrome.debugger.sendCommand(
        debuggeeId, "Fetch.getResponseBody",
        { requestId: String(requestId) },
        (body) => {
          if (body === undefined) {
            disableOnAnotherPage(debuggeeId, requestId)
            return;
          }
          let encodedHTML = body.body;
          let decoded = atob(body.body)

          //To allow using Web workers for off-screen canvas painting
          if (frameId.resourceType === "Document") {
            if (settingsObject.useWorkerActually === true) {
              let finalHTML = decoded.replace(`worker-src 'self'`, `worker-src 'self' data:`)
              encodedHTML = btoa(finalHTML);
            }
            let finish = false;
            if (frameId.request.url.includes('mskchess')) { finish = true; }
            fullfillRequest(encodedHTML, debuggeeId, frameId, true)
          }
          else if (frameId.resourceType === "Script" && frameId.request.url.includes('round')) {
            let completed;
            let tIndex = decoded.search(/!\w{1}\.isT/);
            if (tIndex !== -1) {
              let dIndex = decoded.search(/\.isT/);
              let numberOfLetters = dIndex - tIndex - 1;
              completed = decoded.replace(/!\w\.isT\w{6}/, `(${decoded.substr(tIndex, numberOfLetters + 11)} && (!${decoded.substr(tIndex + 1, numberOfLetters)}.data || ${decoded.substr(tIndex + 1, numberOfLetters)}.data[5] !== '-'))`);
            } else {
              completed = decoded
            }
            let stateMatch = completed.match(/const ([a-zA-Z]+) ?= ?([a-zA-Z0-9_]+)\.defaults\(\);/)[0];
            let localConst = stateMatch.match(/const ([a-zA-Z]+) ?=/)[0].substr(6).replace(/ ?=/, '');
            completed = completed.replace(stateMatch, `const ${localConst} = globalStateReference = ${stateMatch.match(/([a-zA-Z]+)\.defaults\(\);/)[0]}`);
            let finalHTML = `${completed}`
            encodedHTML = btoa(finalHTML);
            fullfillRequest(encodedHTML, debuggeeId, frameId, true)
          } else {
            fullfillRequest(encodedHTML, debuggeeId, frameId, true)
          }
        });
    }
  });

  const disableOnAnotherPage = (debuggeeId, requestId) => {
    chrome.debugger.sendCommand(debuggeeId, "Fetch.continueRequest",
      { requestId: String(requestId) }, () => {
        chrome.debugger.sendCommand(
          debuggeeId, "Fetch.disable",
          () => {
            detachDebugger(debuggeeId);
          });
      })
  }

  const fullfillRequest = (encodedHTML, debuggeeId, frameId, finish = false) => {
    chrome.debugger.sendCommand(
      debuggeeId, "Fetch.fulfillRequest",
      {
        requestId: frameId.requestId,
        responseCode: frameId.responseStatusCode,
        body: encodedHTML
      },
      () => {
        if (finish === false) return
        chrome.debugger.sendCommand(
          debuggeeId, "Fetch.disable",
          () => {
            detachDebugger(debuggeeId);
          });
      });
  }
  const detachDebugger = (debuggeeId) => {
    chrome.debugger.detach(debuggeeId, () => {
      if (objectOfTabsToStop[debuggeeId.tabId] === undefined) {
        debugger; return;
      }
      objectOfTabsToStop[debuggeeId.tabId].debugger = false;
    })
  }
}

if (settingsObject.useWorkerActually === true) {
  requests();
}

let contentScripts = ["css.js", "settings.js"]


let arrayOfTabsToDelayInjection = [];
chrome.webNavigation.onCommitted.addListener(details => {
  console.log(performance.now(), 'webNavigation')
  let indexOfTab = arrayOfTabsToDelayInjection.indexOf(details.tabId)
  if (indexOfTab !== -1) {
    injectContent(details.tabId);
    arrayOfTabsToDelayInjection.splice(indexOfTab, 1)
  }
}, {
  url: [{
    hostContains: "lichess.org"
    //,urlMatches: "^https:\/\/(lichess\.org|lichess\.dev)\/(\w{8}|\w{12})(\/white|\/black)?$"
  }, {
    hostContains: "lichess.dev",
  }]
});
//|mskchess\.ru

chrome.webRequest.onCompleted.addListener((details) => {
  if (details.type === 'main_frame') {
    console.log(performance.now(), 'webRequest')
    chrome.tabs.get(details.tabId, (info) => {
      console.log(info, info.url, performance.now());
      if (!info.url.includes(`chrome:`)) {
        injectContent(details.tabId);
      } else {
        arrayOfTabsToDelayInjection.push(details.tabId)
      }
    })
  }
},
  {
    urls: ["https://lichess.org/*", "https://lichess.dev/*"]
  })

const addOtherContentScripts = (tabId) => {
  try {
    contentScripts.map(x => {
      chrome.tabs.executeScript(tabId, {
        file: x,
        runAt: "document_start"
      });

    })
  } catch (e) { console.log(e) }

  return true;
}

const injectContent = (tabId) => {
  if (updateInfo.versions.content.v <= initialUpdateInfo.versions.content.v) {
    if (!addOtherContentScripts(tabId)) return;
    chrome.tabs.executeScript(tabId, {
      file: "content.js",
      runAt: "document_start"
    });
    console.log('file')
  } else {
    chrome.tabs.executeScript(tabId, {
      code: contentScriptsString + filesObject.content,
      runAt: "document_start"
    });
    console.log('code');
  }
}


chrome.runtime.onMessage.addListener(
  function (request, sender, sendResponse) {
    if (request.type === "injectContent") {
      injectContent(sender.tab.id);
    } else if (request.type === "checkUpdates") {
      checkUpdates(sendResponse);
      return true;
    }
  });

let filesObject = {}
let initialUpdateInfo = chrome.runtime.getManifest().update;
let updateInfo = JSON.parse(JSON.stringify(initialUpdateInfo))

const checkVersions = () => {
  checkVersionsHasBeenCalled = true;
  return new Promise((res, rej) => {
    chrome.storage.local.get(['versions'], function (result) {
      if (!(result && result.versions)) {
        //checkUpdates();
        res();
        return;
      }
      let versionsToSet = result.versions;
      for (const key in updateInfo.versions) {
        if (updateInfo.versions.hasOwnProperty(key)) {
          if (!result.versions[key]) return;
          if (updateInfo.versions[key].v < result.versions[key].v) {
            updateInfo.versions[key].v = result.versions[key].v
            versionsToSet[key].v = result.versions[key].v
            if (key !== 'script') {
              chrome.storage.local.get([key], function (result) {
                if (!result[key]) return;
                filesObject[key] = result[key]
              })
            }
          } else {
            chrome.storage.local.remove([key], function () { delete filesObject[key] })
            delete versionsToSet[key];
          }
        }
      }
      chrome.storage.local.set({ versions: versionsToSet });
      setTimeout(() => {
        res();
      }, 200);
    });
  })
}

let checkVersionsHasBeenCalled = false;
//console.log(updateInfo)
let updateJsUrls = {
  manifest: 'https://raw.githubusercontent.com/Sentero-esp12/Multi-Premoves-Mouse-Keyboard/master/Extension/manifest.json'
}

const checkUpdates = async (sendResponse = undefined) => {
  if (checkVersionsHasBeenCalled === false) {
    await checkVersions();
  }
  let versionsToSet = {};
  Promise.all([updateJsUrls.manifest].map(u => fetch(u))).then(responses =>
    Promise.all(responses.map(res => res.text()))
  ).then(info => {
    let updateObject = JSON.parse(info[0]).update;
    let versions = updateObject.versions
    let toUpdate = [];
    for (const key in versions) {
      if (versions.hasOwnProperty(key)) {
        const item = versions[key];
        if (item.v > updateInfo.versions[key].v) {
          toUpdate.push({ name: key, url: updateInfo.versions[key].url })
        }
        versionsToSet[key] = {};
        versionsToSet[key].v = item.v;
      }
    }
    if (toUpdate.length === 0) {
      if (sendResponse) { sendResponse({ updated: false }); }
      return;
    };
    Promise.all(toUpdate.map(u => fetch(u.url))).then(responses =>
      Promise.all(responses.map(res => res.text()))
    ).then(info => {
      info.map((x, i) => {
        if (toUpdate[i].name !== 'script') {
          filesObject[toUpdate[i].name] = x;
        }
        chrome.storage.local.set({ [toUpdate[i].name]: x }, function () {
          if (sendResponse) sendResponse({ updated: true });
        });
      })
      chrome.storage.local.set({ versions: versionsToSet }, function () {
        // console.log(result.versions)
      });
    })
  })
}



const removeVersions = () => {
  chrome.storage.local.clear();
}


let contentScriptsString = "";
const loadContentFilesToString = () => {
  chrome.runtime.getPackageDirectoryEntry(function (root) {
    contentScripts.map(x => {
      root.getFile(x, {}, function (fileEntry) {
        fileEntry.file(function (file) {
          var reader = new FileReader();
          reader.onloadend = function (e) {
            contentScriptsString += this.result;
          };
          reader.readAsText(file);
        }, () => { console.log('err') });
      }, () => { console.log('err') });
    })
  });
}
loadContentFilesToString();

const errorHandler = (err) => {
}




﻿(function () {
    "use strict";

    var spa = {}; // Single-Page Application
    spa.history = []; // historia przeglądanych stron - tablica url
    var app = {}; 
    var mainView = $('main');

    app.onDeviceReady = function () {
        // Handle the Cordova pause and resume events
        document.addEventListener('pause', app.onPause, false);
        document.addEventListener('resume', app.onResume, false);
        document.addEventListener("backbutton", app.onBackKeyDown, false);

        app.openDatabase(function () {
            app.createFolders(function () {
                app.init();
            });
        });
    };

    app.init = function () {
        spa.init();
        spa.route('mainPage.html');
    };

    app.onPause = function () {
        // TODO: This application has been suspended. Save application state here.
    };

    app.onResume = function () {
        // TODO: This application has been reactivated. Restore application state here.
    };

    app.onBackKeyDown = function () {
        if (spa.history.length > 1) // jeśli w tablicy są podstrony
            spa.route('back');
        else
            navigator.app.exitApp(); // zamknięcie aplikacji
    };

    app.openDatabase = function (onSuccess) {
        app.db = window.sqlitePlugin.openDatabase({ name: 'mytravels.db', location: 'default' }, function (db) {
            db.transaction(function (tx) {
                //tx.executeSql('DROP TABLE IF EXISTS album');
                //tx.executeSql('DROP TABLE IF EXISTS picture');
                tx.executeSql('CREATE TABLE IF NOT EXISTS album (id integer primary key autoincrement, name text, description text)');
                tx.executeSql('CREATE TABLE IF NOT EXISTS picture (id integer primary key autoincrement, album_id integer, path text, thumbnail_path text, latitude Decimal(8,6), longitude Decimal(9,6))');
            }, function (error) {
                app.onError('Nie mażna utworzyć tabel');
            }, onSuccess);
        }, function (error) {
            app.onError('Nie można utworzyć bazy danych');
        });
    };

    app.createFolders = function (onSuccess) {
        var saveFolder = 'albums', // nazwa folderu gdzie będą zapisywane zdjęcia
            thumbnailsFolder = 'thumbnails', //nazwa folderu na miniaturki zdjęć
            rootPath = (cordova.platformId === 'windows') ? cordova.file.dataDirectory : cordova.file.externalDataDirectory;

        app.mainPath = rootPath + saveFolder;
        app.thumbnailsPath = rootPath + thumbnailsFolder;

        createFolder(saveFolder, function () {
            createFolder(thumbnailsFolder, onSuccess);
        });

        function createFolder(folderName, createSuccess) {
            window.resolveLocalFileSystemURL(rootPath, function (fileSys) {
                fileSys.getDirectory(folderName, { create: true, exclusive: false }, function (directory) { //wybiera folder o nazwie folderName, jeśli nie znajdzie to go utworzy
                    createSuccess();
                }, onError.bind(null, saveFolder));
            }, onError.bind(null, saveFolder));
        }

        function onError(folderName) {
            app.onError('Błąd utworzenia folderu: ' + folderName);
        }
    };

    app.mainPage = function (params) {
        $('title').innerText = 'My Travels';

        app.db.executeSql("SELECT * FROM album ORDER BY id DESC", [], function (res) {
            var output = '';
            for (var i = 0; i < res.rows.length; i++) {
                output += '<a href="album.html?id=' + res.rows.item(i).id +
                    '" class="button-list">' + res.rows.item(i).name + '</a>';
            }

            if (res.rows.length)
                $('albumList').innerHTML = output;
            else
                $('albumList').innerHTML = '<div class="list-info">Brak</div>';
        });
    };

    app.newAlbum = function (params) {
        $('title').innerText = 'Dodaj nowy album';

        var form = $('addAlbum'); // formularz
        form.addEventListener("submit", addAlbum, false);

        function addAlbum(e) {
            e.preventDefault();
            var name = $('name').value;
            var description = $('description').value;

            if (name !== "") {
                app.db.executeSql("INSERT INTO album (name, description) VALUES (?,?)", [name, description], function (res) {
                    alert('Dodano!');
                    spa.route('back');
                }, function (error) {
                    app.onError('Błąd. Nie zapisano');
                });
            } else {
                app.onError('Podaj nazwę albumu');
            }
        }
    };

    app.album = function (params) {
        var album,
            newPicture = {},
            CAMERA = Camera.PictureSourceType.CAMERA,
            PHOTOLIBRARY = Camera.PictureSourceType.PHOTOLIBRARY;

        getAlbum(params.id);

        function getAlbum(id) {
            app.db.executeSql("SELECT * FROM album WHERE id = ?", [id], function (res) {
                if (res.rows.length)
                    albumPageInit(res.rows.item(0));
                else
                    app.onError('Nie znaleziono albumu');
            });
        }

        function albumPageInit(row) {
            album = row;

            // wyświetlenie liczby zdjęć
            app.db.executeSql("SELECT COUNT(*) as count FROM picture WHERE album_id = ?", [album.id], function (res) {
                if (res.rows.length)
                    $('photoCount').innerText = res.rows.item(0).count;
            });

            $('title').innerText = album.name;
            $('albumDesc').innerHTML = album.description;

            $('takePhoto').addEventListener('click', function () {
                newPicture.source = CAMERA;
                getCamera(CAMERA);
            }, false);

            $('getPhoto').addEventListener('click', function () {
                newPicture.source = PHOTOLIBRARY;
                getCamera(PHOTOLIBRARY);
            }, false);

            getPictures();

        }

        function getPictures() {
            app.db.executeSql("SELECT * FROM picture WHERE album_id = ? ORDER BY id DESC", [album.id], function (res) {
                var output = '';
                for (var i = 0; i < res.rows.length; i++) {
                    output += '<a href="photo.html?id=' + res.rows.item(i).id +
                        '"><img src="' + res.rows.item(i).thumbnail_path + '" /></a>';
                }

                if (res.rows.length)
                    $('photoList').innerHTML = output;
                else
                    $('photoList').innerHTML = '<div class="list-info">Brak</div>';
            });
        }

        function getCamera(source) {
            app.showLoader();

            navigator.camera.getPicture(function (photoUri) {
                window.resolveLocalFileSystemURL(photoUri, savePicture, onError);
            }, function () {
                spa.refreshPage();
                app.hideLoader();
            }, {
                sourceType: source,
                quality: 100,
                destinationType: navigator.camera.DestinationType.FILE_URI
            });
        }

        function onError(error) {
            app.onError('Błąd zapisu zdjęcia');
        }

        function savePicture(entry) {
            var d = new Date(),
                fileName = d.getTime() + ".jpeg";

            window.resolveLocalFileSystemURL(app.mainPath, function (fileSys) {
                newPicture.path = fileSys.toURL() + album.name + "/" + fileName;
                fileSys.getDirectory(album.name, { create: true, exclusive: false }, function (directory) {
                    entry.moveTo(directory, fileName, createThumbnail, onError);
                }, onError);
            }, onError);
        }

        function createThumbnail() {
            alert('Dodano');
            app.hideLoader();
        }
    };

    

    app.onError = function (message) {
        console.log(message);
        alert(message);
    };

    app.showLoader = function () {
        $('wait').style.display = 'flex';
    };

    app.hideLoader = function () {
        $('wait').style.display = 'none';
    };


    spa.init = function () { // przechwycenie zdarzenia kliknięcia w link
        document.body.onclick = function (e) { // click event dla każego elementu strony
            e = e || window.event;
            var link = findLink(e.target || e.srcElement);
            if (link && link.getAttribute('href').indexOf('#') == -1) { // jeśli element jest linkiem i nie jest kotwicą (#)
                spa.route(link.getAttribute('href'));
                return false;
            }
        };
        function findLink(el) { // el - najniższy element
            if (el.tagName === 'A') // czy element jest linkiem - zwraca link
                return el; 
            while (el = el.parentNode) // dopóki element ma rodzica
                if (el.tagName === 'A')
                    return el;
            return null;
        }
    };

    spa.route = function (url) { // przekierowanie do podstrony
        url = spa.getParameters(spa.saveURL(url));
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url.page, true);
        xhr.onload = function (e) {
            var response = e.currentTarget;
            if (response.status == 200) { // strona została poprawnie wczytana
                mainView.innerHTML = response.responseText;
                var fun = url.page.split('.')[0]; // zwraca nazwę strony bez rozszerzenia
                if (fun === 'mainPage')
                    spa.mainPage();
                else
                    spa.subPage();

                if (app[fun])
                    app[fun](url.params); // wywołanie funkcji dla danej strony np.: app.nazwastrony() dla nazwastrony.html
            } else // błąd
                spa.history.pop();
        };
        xhr.onerror = function (e) {
            spa.history.pop();
        };
        xhr.send();
    };

    spa.getParameters = function (url) { // zwraca obiekt z nazwą strony i parametrami
        var page = url,
            params = {};

        if (url.indexOf('?') > 0) {
            page = url.split('?')[0];
            var query = url.split('?')[1].split('&');
            for (var i = 0; i < query.length; i++) {
                var param = query[i].split('=');
                params[param[0]] = param[1];
            }
        }
        return {
            page: page,
            params: params
        };
    };

    spa.saveURL = function (url) { // zapis url strony w tablicy spa.history
        if (url === 'back') {
            spa.history.pop();
            url = spa.history[spa.history.length - 1];
        } else
            spa.history.push(url);
        return url;
    };

    spa.refreshPage = function () {
        var url = spa.history[spa.history.length - 1];
        spa.history.pop();
        spa.route(url);
    };

    spa.subPage = function () { // wczytano podstronę
        $('backNav').innerHTML = '<a href="back"><i class="icon-left"></i></a>';
    };

    spa.mainPage = function () { // wczytano stronę główną
        $('backNav').innerHTML = '<i class="icon-paper-plane"></i>';
    };

 

    function $(id) {
        return document.getElementById(id);
    }

    document.addEventListener('deviceready', app.onDeviceReady, false); 

} )();